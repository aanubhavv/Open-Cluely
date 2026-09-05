/**
 * Speculative question pre-answerer.
 *
 * A speech recognizer emits a growing version of the current utterance. A
 * later partial often contains the first question again (for example:
 * "What is X? How does Y work?"). Treating the whole partial as a new
 * question creates duplicate or empty answer bubbles, so this module keeps
 * one question group and only starts work for genuinely new clauses.
 */

const QUESTION_START = /^(what|how|why|when|where|who|which|can|could|would|should|is|are|do|does|did|tell|explain|walk|describe|give)\b/i;
const QUESTION_PHRASES = /\b(can you|could you|would you|tell me|walk me through|explain|describe|what is|what are|what was|what were|how do|how does|how would|how did|why is|why are|why did|is there|are there|do you|does it|did you)\b/i;
// These phrases are safe to find inside a sentence. They let us discard an
// acknowledgement or transition before the actual question (for example,
// "Thanks for sharing... Moving on, can you describe...").
const QUESTION_PHRASE_ANYWHERE = /\b(?:can you|could you|would you|should you|tell me|walk me through|what (?:is|are|was|were)|how (?:do|does|would|did)|why (?:is|are|did|do|does)|is there|are there|do you|does it|did you)\b/i;
const QUESTION_START_ANYWHERE = /\b(?:what|how|why|when|where|who|which|can|could|would|should|is|are|do|does|did|tell|explain|walk|describe|give)\b/ig;
const QUESTION_LEAD_IN = /^(?:(?:moving on|now|also|plus|next|so|then|well|okay|alright|anyway|by the way|i wanted to ask|i would like to ask|i'd like to ask)[,;:\s-]*)+$/i;
const QUESTION_CONTEXT_LEAD_IN = /^(?:(?:for|regarding|about|as for|on|with respect to|when it comes to)\s+(?:the\s+)?(?:last|next|previous|current|following|this|that|your|my)?\s*(?:question|topic|experience|project|role|background)|(?:i was wondering|i wanted to know|i would like to know|i'd like to know|i have a question)|(?:one more question|another question))[,;:\s-]*$/i;
const QUESTION_START_AFTER_CONJUNCTION = /\s+(?:and|also|plus)\s+(?=(?:what|how|why|when|where|who|which|can|could|would|should|is|are|do|does|did|tell|explain|walk|describe|give)\b)/ig;
const MIN_WORD_COUNT = 3;

function normalizeText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function questionKey(text) {
  return normalizeText(text)
    .toLowerCase()
    .replace(/[?!.:,;]+$/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeQuestion(text) {
  const candidate = normalizeText(text);
  if (!candidate) return false;
  const words = candidate.split(/\s+/).filter(Boolean);
  if (words.length < MIN_WORD_COUNT) return false;
  return candidate.endsWith('?') || QUESTION_START.test(candidate) || QUESTION_PHRASES.test(candidate);
}

function splitConjoinedQuestions(text) {
  const candidate = normalizeText(text);
  if (!candidate) return [];

  const parts = [];
  let start = 0;
  candidate.replace(QUESTION_START_AFTER_CONJUNCTION, (match, offset) => {
    parts.push(candidate.slice(start, offset).trim());
    // Drop the conjunction and begin the next question at its interrogative
    // word (for example, "and how" becomes "how").
    start = offset + match.length;
    return match;
  });
  parts.push(candidate.slice(start).trim());
  return parts.filter(Boolean);
}

function findQuestionStart(text) {
  const candidate = normalizeText(text);
  if (!candidate || QUESTION_START.test(candidate)) return 0;

  // A generic word such as "what" is only accepted when it follows a
  // sentence boundary or a known conversational lead-in, so phrases like
  // "sharing what you built" are not mistaken for a new question.
  let questionWordStart = -1;
  QUESTION_START_ANYWHERE.lastIndex = 0;
  let wordMatch;
  while ((wordMatch = QUESTION_START_ANYWHERE.exec(candidate))) {
    const prefix = candidate.slice(0, wordMatch.index);
    const boundary = Math.max(
      prefix.lastIndexOf('.'),
      prefix.lastIndexOf('!'),
      prefix.lastIndexOf('?')
    );
    const localPrefix = prefix.slice(boundary + 1).trim();

    if (
      !localPrefix
      || QUESTION_LEAD_IN.test(localPrefix)
      || QUESTION_CONTEXT_LEAD_IN.test(localPrefix)
    ) {
      questionWordStart = wordMatch.index;
      break;
    }
  }

  // Phrase matching is only a fallback at a real question boundary. A broad
  // match anywhere in the sentence would incorrectly turn
  // "what new skill did you learn" into "did you learn".
  let phraseQuestionStart = -1;
  const phraseMatchRegex = new RegExp(QUESTION_PHRASE_ANYWHERE.source, 'ig');
  let phraseMatch;
  while ((phraseMatch = phraseMatchRegex.exec(candidate))) {
    const prefix = candidate.slice(0, phraseMatch.index);
    const boundary = Math.max(
      prefix.lastIndexOf('.'),
      prefix.lastIndexOf('!'),
      prefix.lastIndexOf('?')
    );
    const localPrefix = prefix.slice(boundary + 1).trim();
    if (
      !localPrefix
      || QUESTION_LEAD_IN.test(localPrefix)
      || QUESTION_CONTEXT_LEAD_IN.test(localPrefix)
    ) {
      phraseQuestionStart = phraseMatch.index;
      break;
    }
  }

  if (
    phraseQuestionStart >= 0
    && (questionWordStart < 0 || phraseQuestionStart < questionWordStart)
  ) {
    return phraseQuestionStart;
  }

  return questionWordStart;
}

function extractQuestionText(text) {
  const candidate = normalizeText(text);
  const questionStart = findQuestionStart(candidate);
  if (questionStart < 0) return candidate;
  return normalizeText(candidate.slice(questionStart));
}

/**
 * Returns clauses in transcript order. A question mark is the strongest
 * boundary; conjunctions before a new question word cover STT output that
 * omitted punctuation ("what is X and how does Y work").
 */
function extractQuestionCandidates(text) {
  const input = normalizeText(text);
  if (!input) return [];

  const clauses = [];
  let start = 0;
  for (let index = 0; index < input.length; index += 1) {
    if (input[index] !== '?') continue;
    clauses.push(input.slice(start, index + 1).trim());
    start = index + 1;
  }
  if (start < input.length) clauses.push(input.slice(start).trim());

  return clauses
    .flatMap(splitConjoinedQuestions)
    .map((clause) => extractQuestionText(clause))
    .filter(looksLikeQuestion);
}

function isCompleteQuestion(text) {
  return normalizeText(text).endsWith('?');
}

export { extractQuestionCandidates };

export function createSpeculativeAnswerer({
  getContext,
  onPrefetchStart,
  onPrefetchCancel,
  onCommit,
  onGroupComplete,
  onError,
  debounceMs = 100,
  silenceMs = 900,
  groupSettleMs = 1800
}) {
  let state = 'idle';
  let debounceTimer = null;
  let silenceTimer = null;
  let groupSettleTimer = null;
  let currentRequestId = 0;
  let groupId = 0;
  let activeRequest = null;
  let removeChunkListener = null;
  let removeEndListener = null;
  let questionGroup = [];

  function clearTimer(timerName) {
    if (timerName === 'debounce' && debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (timerName === 'silence' && silenceTimer) {
      clearTimeout(silenceTimer);
      silenceTimer = null;
    }
    if (timerName === 'settle' && groupSettleTimer) {
      clearTimeout(groupSettleTimer);
      groupSettleTimer = null;
    }
  }

  function detachActiveListeners() {
    if (removeChunkListener) {
      removeChunkListener();
      removeChunkListener = null;
    }
    if (removeEndListener) {
      removeEndListener();
      removeEndListener = null;
    }
  }

  function ensureQuestionGroup() {
    if (questionGroup.length === 0) groupId += 1;
    return groupId;
  }

  function findQuestion(text) {
    const key = questionKey(text);
    return questionGroup.find((entry) => (
      entry.key === key
      || key.startsWith(`${entry.key} `)
      || entry.key.startsWith(`${key} `)
    ));
  }

  function sameQuestionText(first, second) {
    const firstKey = questionKey(first);
    const secondKey = questionKey(second);
    return firstKey === secondKey
      || firstKey.startsWith(`${secondKey} `)
      || secondKey.startsWith(`${firstKey} `);
  }

  function rememberQuestion(text) {
    const normalized = normalizeText(text);
    const existing = findQuestion(normalized);
    if (existing) {
      // Keep the most complete wording as partial STT text grows.
      if (normalized.length > existing.text.length) {
        existing.text = normalized;
        existing.key = questionKey(normalized);
      }
      return existing;
    }

    ensureQuestionGroup();
    const entry = {
      text: normalized,
      key: questionKey(normalized),
      started: false,
      committed: false
    };
    questionGroup.push(entry);
    return entry;
  }

  function scheduleGroupCompletion() {
    clearTimer('settle');
    if (questionGroup.length === 0) return;

    const completedQuestions = questionGroup
      .filter((entry) => entry.committed)
      .map((entry) => entry.text);
    if (completedQuestions.length === 0) return;

    const settledGroupId = groupId;
    groupSettleTimer = setTimeout(() => {
      groupSettleTimer = null;
      if (settledGroupId !== groupId) return;
      onGroupComplete?.(completedQuestions, settledGroupId);
      questionGroup = [];
    }, groupSettleMs);
  }

  function notifyRequestError(request, error) {
    if (request.cancelled) return;
    console.error('[speculative-answerer] Request error:', error?.message);
    onError?.(error);
  }

  async function invokeRequest(request) {
    try {
      let context = await getContext?.({
        groupId,
        questionText: request.questionText
      }) || {};

      // Follow-up answers must not be generated from a partial previous answer.
      // The renderer exposes a promise for the earlier sections in this group;
      // waiting here keeps the first answer fast while making later answers
      // deterministic and story-consistent.
      if (context.waitForRelatedAnswers) {
        await context.waitForRelatedAnswers;
        if (request.cancelled) return;
        context = await getContext?.({
          groupId,
          questionText: request.questionText
        }) || {};
      }

      if (request.cancelled) return;

      window.electronAPI.speculativeAnswer({
        questionText: request.questionText,
        contextString: context.contextString || '',
        relatedQuestionContext: context.relatedQuestionContext || '',
        requestId: request.id
      }).catch((error) => notifyRequestError(request, error));
    } catch (error) {
      notifyRequestError(request, error);
    }
  }

  function attachRequestListeners(request) {
    removeChunkListener = window.electronAPI.onAiStreamChunk((data) => {
      if (data.actionId !== 'speculative' || data.requestId !== request.id) return;
      request.bufferedText += String(data.text || '');
    });

    if (window.electronAPI.onAiStreamEnd) {
      removeEndListener = window.electronAPI.onAiStreamEnd((data) => {
        if (data.actionId !== 'speculative' || data.requestId !== request.id) return;
        request.isComplete = true;
      });
    }
  }

  function startPrefetch(questionText) {
    const normalized = normalizeText(questionText);
    if (!looksLikeQuestion(normalized)) return;

    if (activeRequest && sameQuestionText(activeRequest.questionText, normalized)) {
      activeRequest.questionText = normalized;
      return;
    }

    if (activeRequest) activeRequest.cancelled = true;
    detachActiveListeners();
    currentRequestId += 1;
    const request = {
      id: currentRequestId,
      questionText: normalized,
      bufferedText: '',
      isComplete: false,
      cancelled: false
    };
    activeRequest = request;
    state = 'prefetching';
    rememberQuestion(normalized).started = true;
    onPrefetchStart?.();
    attachRequestListeners(request);
    invokeRequest(request);
  }

  function commitActive(questionText, { immediate = false } = {}) {
    const request = activeRequest;
    if (!request) return false;

    const entry = rememberQuestion(questionText || request.questionText);
    entry.text = normalizeText(questionText || request.questionText);
    entry.key = questionKey(entry.text);
    entry.started = true;
    entry.committed = true;

    detachActiveListeners();
    clearTimer('debounce');
    clearTimer('silence');
    activeRequest = null;
    state = 'idle';

    const bufferedText = request.bufferedText;
    const isComplete = request.isComplete;
    const requestId = request.id;
    const committedQuestion = entry.text;
    const questionIndex = questionGroup.indexOf(entry);

    function listenForMore(onChunk, onDone) {
      if (isComplete) {
        onDone?.();
        return () => {};
      }

      const removeChunk = window.electronAPI.onAiStreamChunk((data) => {
        if (data.actionId !== 'speculative' || data.requestId !== requestId) return;
        onChunk?.(String(data.text || ''));
      });

      let removeDone = () => {};
      if (window.electronAPI.onAiStreamEnd) {
        removeDone = window.electronAPI.onAiStreamEnd((data) => {
          if (data.actionId !== 'speculative' || data.requestId !== requestId) return;
          removeChunk();
          removeDone();
          onDone?.();
        });
      }

      return () => {
        removeChunk();
        removeDone();
      };
    }

    onCommit?.(bufferedText, isComplete, listenForMore, committedQuestion, {
      append: questionIndex > 0,
      questionIndex,
      groupId,
      immediate
    });
    scheduleGroupCompletion();
    return true;
  }

  function triggerFreshAndCommit(questionText) {
    startPrefetch(questionText);
    // Use a visible placeholder while the fresh request streams. This avoids
    // ever creating a blank message when no prefetched token is available.
    commitActive(questionText, { immediate: true });
  }

  function processTranscript(text, { final = false } = {}) {
    const candidates = extractQuestionCandidates(text);
    if (candidates.length === 0) return false;

    const completeCandidates = candidates.filter((candidate) => (
      isCompleteQuestion(candidate) || final
    ));
    if (completeCandidates.length > 0) clearTimer('debounce');

    for (const candidate of completeCandidates) {
      const entry = rememberQuestion(candidate);
      if (entry.committed) continue;

      if (activeRequest) {
        const activeEntry = findQuestion(activeRequest.questionText);
        if (activeEntry === entry || questionKey(activeRequest.questionText) === entry.key) {
          commitActive(candidate);
          continue;
        }
        // A complete clause superseded an older unfinished clause. Commit the
        // older request before starting the new one so no stream is orphaned.
        commitActive(activeRequest.questionText);
      }

      triggerFreshAndCommit(candidate);
    }

    if (!final) {
      const trailing = candidates[candidates.length - 1];
      const prefetchTarget = completeCandidates.length === 0 ? candidates[0] : trailing;
      if (prefetchTarget && !isCompleteQuestion(prefetchTarget)) {
        const entry = rememberQuestion(prefetchTarget);
        if (!entry.committed) {
          if (activeRequest) {
            const activeEntry = findQuestion(activeRequest.questionText);
            if (activeEntry !== entry) commitActive(activeRequest.questionText);
          }
          if (!activeRequest) {
            clearTimer('debounce');
            debounceTimer = setTimeout(() => {
              debounceTimer = null;
              if (!entry.started && !entry.committed && !activeRequest) {
                startPrefetch(entry.text);
              }
            }, debounceMs);
          }
        }
      }
    }

    return true;
  }

  function armSilenceTimer() {
    clearTimer('silence');
    silenceTimer = setTimeout(() => {
      silenceTimer = null;
      if (activeRequest) commitActive(activeRequest.questionText);
    }, silenceMs);
  }

  function feedPartial(source, text) {
    if (source !== 'system') return;
    const normalized = normalizeText(text);
    if (!looksLikeQuestion(normalized) && extractQuestionCandidates(normalized).length === 0) return;

    clearTimer('settle');
    processTranscript(normalized);
    if (activeRequest) armSilenceTimer();
    else scheduleGroupCompletion();
  }

  function feedFinal(source, text) {
    if (source !== 'system') return;
    const normalized = normalizeText(text);
    if (!normalized) return;

    const hadQuestions = processTranscript(normalized, { final: true });
    if (!hadQuestions) {
      if (activeRequest) commitActive(activeRequest.questionText);
      return;
    }

    clearTimer('silence');
    if (activeRequest) commitActive(activeRequest.questionText);
    scheduleGroupCompletion();
  }

  function cancel() {
    clearTimer('debounce');
    clearTimer('silence');
    clearTimer('settle');
    detachActiveListeners();
    if (activeRequest) activeRequest.cancelled = true;
    if (state !== 'idle') onPrefetchCancel?.();
    activeRequest = null;
    state = 'idle';
    questionGroup = [];
  }

  function destroy() {
    cancel();
  }

  return { feedPartial, feedFinal, cancel, destroy };
}
