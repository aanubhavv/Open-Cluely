/**
 * Speculative Question Pre-Answerer
 *
 * Strategy: detect questions in real-time from the host partial transcript,
 * start an AI request immediately (while the host is still speaking), buffer
 * the streaming chunks, and commit (show) the answer the moment the host
 * finishes. Because the AI has been generating for several seconds already,
 * the answer is available near-instantly.
 *
 * Speed optimizations:
 *  1. Only 100ms debounce before pre-fetch starts (was 400ms)
 *  2. Partial ending with "?" triggers immediate commit (no waiting for final event)
 *  3. Silence timer: if no new partial arrives for 900ms after question detected, auto-commit
 *
 * State machine: idle -> debouncing -> prefetching -> (commit) -> idle
 */

// ---- Question Detection -----------------------------------------------------

const QUESTION_START = /^(what|how|why|when|where|who|which|can|could|would|should|is|are|do|does|did|tell|explain|walk|describe|give)\b/i;
const QUESTION_PHRASES = /\b(can you|could you|would you|tell me|walk me through|explain|describe|what is|what are|what was|what were|how do|how does|how would|how did|why is|why are|why did|is there|are there|do you|does it|did you)\b/i;
const MIN_WORD_COUNT = 4;

function looksLikeQuestion(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < MIN_WORD_COUNT) return false;
  return t.endsWith('?') || QUESTION_START.test(t) || QUESTION_PHRASES.test(t);
}

/** True when the partial text strongly signals the question is done (ends with ?) */
function isQuestionComplete(text) {
  return String(text || '').trim().endsWith('?');
}

// ---- Factory ----------------------------------------------------------------

export function createSpeculativeAnswerer({
  getContext,
  onPrefetchStart,
  onPrefetchCancel,
  onCommit,
  onError,
  debounceMs = 100,      // Start pre-fetch 100ms after question detected in partial
  silenceMs = 900        // Auto-commit if no new partial for 900ms (host paused)
}) {
  let state = 'idle'; // 'idle' | 'debouncing' | 'prefetching'
  let debounceTimer = null;
  let silenceTimer = null;
  let currentRequestId = 0;
  let bufferedText = '';
  let prefetchComplete = false;
  let removeChunkListener = null;
  let removeEndListener = null;
  let lastQuestionText = '';
  let lastPartialText = '';

  // ---- Internal helpers -----------------------------------------------------

  function _detachListeners() {
    if (removeChunkListener) { removeChunkListener(); removeChunkListener = null; }
    if (removeEndListener) { removeEndListener(); removeEndListener = null; }
  }

  function _clearDebounce() {
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
  }

  function _clearSilence() {
    if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
  }

  function _attachListeners(requestId) {
    removeChunkListener = window.electronAPI.onAiStreamChunk((data) => {
      if (data.actionId !== 'speculative' || data.requestId !== requestId) return;
      bufferedText += data.text;
    });

    if (window.electronAPI.onAiStreamEnd) {
      removeEndListener = window.electronAPI.onAiStreamEnd((data) => {
        if (data.actionId !== 'speculative' || data.requestId !== requestId) return;
        prefetchComplete = true;
      });
    }
  }

  // ---- Pre-fetch ------------------------------------------------------------

  async function _startPrefetch(questionText) {
    _detachListeners();

    currentRequestId += 1;
    const myRequestId = currentRequestId;
    bufferedText = '';
    prefetchComplete = false;
    lastQuestionText = questionText;
    state = 'prefetching';

    onPrefetchStart?.();
    _attachListeners(myRequestId);

    const context = getContext?.() || {};

    try {
      await window.electronAPI.speculativeAnswer({
        questionText,
        contextString: context.contextString || '',
        requestId: myRequestId
      });
    } catch (err) {
      if (myRequestId === currentRequestId && state === 'prefetching') {
        console.error('[speculative-answerer] Pre-fetch error:', err?.message);
        onError?.(err);
        cancel();
      }
    }
  }

  // ---- Commit ---------------------------------------------------------------

  function _commit(questionText) {
    if (state !== 'prefetching' && state !== 'debouncing') return;

    const myRequestId = currentRequestId;
    const myBufferedText = bufferedText;
    const isComplete = prefetchComplete;

    _detachListeners();
    _clearDebounce();
    _clearSilence();
    state = 'idle';
    bufferedText = '';
    prefetchComplete = false;
    lastQuestionText = '';
    lastPartialText = '';

    function listenForMore(onChunk, onDone) {
      if (isComplete) { onDone?.(); return () => {}; }

      const removeChunk = window.electronAPI.onAiStreamChunk((data) => {
        if (data.actionId !== 'speculative' || data.requestId !== myRequestId) return;
        onChunk?.(data.text);
      });

      let removeDone = () => {};
      if (window.electronAPI.onAiStreamEnd) {
        removeDone = window.electronAPI.onAiStreamEnd((data) => {
          if (data.actionId !== 'speculative' || data.requestId !== myRequestId) return;
          removeChunk();
          removeDone();
          onDone?.();
        });
      }

      return () => { removeChunk(); removeDone(); };
    }

    onCommit(myBufferedText, isComplete, listenForMore, questionText || lastQuestionText);
  }

  // ---- Fallback: no pre-fetch running when final/silence triggered -----------

  function _triggerFreshAndCommit(questionText) {
    currentRequestId += 1;
    const myRequestId = currentRequestId;
    bufferedText = '';
    prefetchComplete = false;
    lastQuestionText = questionText;
    state = 'prefetching';

    onPrefetchStart?.();
    _attachListeners(myRequestId);

    const context = getContext?.() || {};
    window.electronAPI.speculativeAnswer({
      questionText,
      contextString: context.contextString || '',
      requestId: myRequestId
    }).catch((err) => {
      if (myRequestId === currentRequestId) {
        console.error('[speculative-answerer] Fresh call error:', err?.message);
        onError?.(err);
      }
    });

    // Commit immediately with empty buffer — all chunks stream in live
    _commit(questionText);
  }

  // ---- Silence timer --------------------------------------------------------

  function _armSilenceTimer(questionText) {
    _clearSilence();
    silenceTimer = setTimeout(() => {
      silenceTimer = null;
      console.log('[speculative-answerer] Silence timeout — committing');
      if (state === 'prefetching') {
        _commit(questionText);
      } else if (state === 'debouncing') {
        _clearDebounce();
        _triggerFreshAndCommit(questionText);
      }
    }, silenceMs);
  }

  // ---- Public API -----------------------------------------------------------

  function feedPartial(source, text) {
    if (source !== 'system') return;
    const trimmed = String(text || '').trim();

    if (!looksLikeQuestion(trimmed)) {
      if (state === 'debouncing') {
        _clearDebounce();
        _clearSilence();
        state = 'idle';
        onPrefetchCancel?.();
      }
      return;
    }

    lastPartialText = trimmed;

    // If the partial already ends with "?" the question is complete — act fast
    if (isQuestionComplete(trimmed)) {
      _clearDebounce();
      _clearSilence();
      if (state === 'prefetching') {
        // Pre-fetch already running — commit now
        _commit(trimmed);
      } else {
        // Start fresh and commit immediately
        _triggerFreshAndCommit(trimmed);
      }
      return;
    }

    // Question shape detected but not yet ended — start/reset pre-fetch debounce
    _clearDebounce();
    if (state !== 'prefetching') state = 'debouncing';

    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      _startPrefetch(trimmed);
    }, debounceMs);

    // Arm the silence timer so we commit even if no final event arrives
    _armSilenceTimer(trimmed);
  }

  function feedFinal(source, text) {
    if (source !== 'system') return;
    const trimmed = String(text || '').trim();

    if (!looksLikeQuestion(trimmed)) {
      if (state === 'debouncing') {
        _clearDebounce();
        _clearSilence();
        state = 'idle';
        onPrefetchCancel?.();
      }
      return;
    }

    // Final transcript confirmed as a question — commit
    _clearSilence();
    if (state === 'prefetching') {
      _commit(trimmed);
    } else if (state === 'debouncing') {
      _clearDebounce();
      _triggerFreshAndCommit(trimmed);
    } else {
      _triggerFreshAndCommit(trimmed);
    }
  }

  function cancel() {
    _clearDebounce();
    _clearSilence();
    _detachListeners();
    if (state === 'debouncing' || state === 'prefetching') onPrefetchCancel?.();
    state = 'idle';
    bufferedText = '';
    prefetchComplete = false;
    lastQuestionText = '';
    lastPartialText = '';
  }

  function destroy() { cancel(); }

  return { feedPartial, feedFinal, cancel, destroy };
}
