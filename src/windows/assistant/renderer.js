/// <reference path="./renderer-globals.d.ts" />

import { createMessageStore } from './renderer/features/ai-context/message-store.js';
import { buildFilteredAiContextBundle as buildAiContextBundle } from './renderer/features/ai-context/context-bundle.js';
import { updateMessageAiToggleUi as syncMessageAiToggleUi } from './renderer/features/ai-context/toggle-ui.js';
import { createChatUiManager } from './renderer/features/chat/chat-ui-manager.js';
import { createWindowAdjustmentManager } from './renderer/features/layout/window-adjustments.js';
import { setupEventListeners as setupEventListenersModule } from './renderer/features/listeners/event-listeners.js';
import { setupIpcListeners as setupIpcListenersModule } from './renderer/features/listeners/ipc-listeners.js';
import { createShortcutManager } from './renderer/features/settings/shortcut-manager.js';
import { createSettingsPanelManager } from './renderer/features/settings/settings-panel-manager.js';
import { createContextProfileManager } from './renderer/features/settings/context-profile-manager.js';
import { createTranscriptionManager } from './renderer/features/transcription/transcription-manager.js';

import {
    createTranscriptionSourceState,
    normalizeSource as normalizeAssemblySource,
    sourceLabel as resolveSourceLabel
} from './renderer/features/assembly-ai/source-state.js';
import { createAudioPipeline } from './renderer/features/assembly-ai/audio-pipeline.js';
import { createTranscriptBufferManager } from './renderer/features/assembly-ai/transcript-buffer.js';
// Renderer with AssemblyAI Streaming Transcription - Real-time & Accurate!
// Uses AssemblyAI WebSocket API for live speech-to-text

let screenshotsCount = 0;
let isAnalyzing = false;
let stealthHideTimeout = null;
const THEME_STORAGE_KEY = 'assistant-theme';
const THEME_LIGHT = 'light';
const THEME_DARK = 'dark';
let activeTheme = THEME_LIGHT;
const AI_CONTEXT_CHAR_BUDGET = 12000;
const messageStore = createMessageStore();
let chatMessagesArray = messageStore.getMessages();
const transcriptionSourceState = createTranscriptionSourceState();

// Source selection state (default: host/system on, mic off)
const selectedSources = transcriptionSourceState.selectedSources;

const audioPipeline = createAudioPipeline({
    sendAudioChunk: (source, audioBuffer) => {
        window.electronAPI.sendAudioChunk(source, audioBuffer);
    },
    addMonitorLog: (...args) => addMonitorLog(...args)
});

const transcriptBufferManager = createTranscriptBufferManager({
    mergeWindowMs: 2400,
    onBuffer: ({ source, text, segments }) => {
        addMonitorLog('info', 'final-buffer', 'Buffered transcript segment', source, {
            segments,
            chars: text.length
        });
        updatePill2Transcript(text, false);
    },
    onFlush: ({ source, text, reason, segments }) => {
        if (source === 'system') {
            addChatMessage('voice-system', text);
        } else {
            addChatMessage('voice-mic', text);
        }

        addMonitorLog('info', 'final-flush', 'Merged transcript committed', source, {
            reason,
            segments,
            chars: text.length
        });
        showFeedback('Captured', 'success');
        updatePill2Transcript(text, true);
    }
});


// DOM elements
const statusText = document.getElementById('status-text');
const loadingOverlay = document.getElementById('loading-overlay');
const emergencyOverlay = document.getElementById('emergency-overlay');
const chatContainer = document.getElementById('chat-container');
const chatMessagesElement = document.getElementById('chat-messages');
const chatComposer = document.getElementById('chat-composer');
const chatManualInput = document.getElementById('chat-manual-input');
const chatManualSend = document.getElementById('chat-manual-send');
const transcriptionToggle = document.getElementById('transcription-toggle');
const sourceSystemToggle = document.getElementById('source-system-toggle');
const sourceMicToggle = document.getElementById('source-mic-toggle');

const windowResizeHandles = []; // Removed in UI redesign

const screenshotBtn = document.getElementById('screenshot-btn');
const analyzeBtn = document.getElementById('analyze-btn');
const clearBtn = document.getElementById('clear-btn');
const closeAppBtn = document.getElementById('close-app-btn');
const closeConfirmationDialog = document.getElementById('close-confirmation-dialog');
const cancelCloseBtn = document.getElementById('cancel-close-btn');
const confirmCloseBtn = document.getElementById('confirm-close-btn');
const clickThroughBtn = document.getElementById('click-through-btn');

// Removed buttons - set to null to avoid ReferenceError
const screenAiBtn = null;
const hideBtn = null;
const closeResultsBtn = null;
const suggestBtn = null;
const notesBtn = null;
const insightsBtn = null;
const themeToggleBtn = null;
const noFocusBtn = null;
const screenshotCount = null;
const resultsPanel = null;

// New Pill DOM Elements
const pill1Controls = document.getElementById('pill-1-controls');
const pill2Listening = document.getElementById('pill-2-listening');
const pill3Content = document.getElementById('pill-3-content');
const pill2TranscriptText = document.getElementById('pill-2-transcript-text');

const chatModeBtn = document.getElementById('chat-mode-btn');
const settingsModeBtn = document.getElementById('settings-mode-btn');
const expandChatBtn = document.getElementById('expand-chat-btn');
const dragHandleBtn = document.getElementById('drag-handle-btn');

const viewAnswer = document.getElementById('view-answer');
const viewChat = document.getElementById('view-chat');
const viewSettings = document.getElementById('view-settings');
const viewContextProfile = document.getElementById('view-context-profile');
const resultText = document.getElementById('result-text');

// Settings elements
const settingsBtn = document.getElementById('settings-btn');
const settingsPanel = document.getElementById('settings-panel');
const closeSettingsBtn = document.getElementById('close-settings');
const saveSettingsBtn = document.getElementById('save-settings-btn');
const settingAiProvider = document.getElementById('setting-ai-provider');
const geminiSettingsGroup = document.getElementById('gemini-settings-group');
const ollamaSettingsGroup = document.getElementById('ollama-settings-group');
const settingGeminiKey = document.getElementById('setting-gemini-key');
const toggleGeminiKeyVisibilityBtn = document.getElementById('toggle-gemini-key-visibility');
const settingGeminiModel = document.getElementById('setting-gemini-model');
const settingOllamaBaseUrl = document.getElementById('setting-ollama-base-url');
const settingOllamaModel = document.getElementById('setting-ollama-model');
const settingOllamaModelSelect = document.getElementById('setting-ollama-model-select');
const fetchOllamaModelsBtn = document.getElementById('fetch-ollama-models');
const settingProgrammingLanguage = document.getElementById('setting-programming-language');
const settingAssemblyKey = document.getElementById('setting-assembly-key');
const toggleAssemblyKeyVisibilityBtn = document.getElementById('toggle-assembly-key-visibility');
const settingAssemblyModel = document.getElementById('setting-assembly-model');
const settingWindowOpacity = document.getElementById('setting-window-opacity');
const settingWindowOpacityValue = document.getElementById('setting-window-opacity-value');
const quickWindowOpacity = document.getElementById('quick-window-opacity');
const settingsShortcutsList = document.getElementById('settings-shortcuts-list');

// Context Profile
const openContextProfileBtn = document.getElementById('open-context-profile-btn');
const contextProfilePanel = document.getElementById('context-profile-panel');
const closeContextProfileBtn = document.getElementById('close-context-profile');
const saveContextProfileBtn = document.getElementById('save-context-profile-btn');
const cpUploadPdfBtn = document.getElementById('cp-upload-pdf-btn');
const cpResumeStatus = document.getElementById('cp-resume-status');
const cpResumeText = document.getElementById('cp-resume-text');
const cpStrengths = document.getElementById('cp-strengths');
const cpWeaknesses = document.getElementById('cp-weaknesses');
const cpPastExperiences = document.getElementById('cp-past-experiences');
const cpAdditionalContext = document.getElementById('cp-additional-context');

// Timer
let startTime = Date.now();
let timerInterval;
const MIN_WINDOW_WIDTH = 600;
const MIN_WINDOW_HEIGHT = 380;
const MAX_CHAT_INPUT_HEIGHT = 88;

let isCloseConfirmationOpen = false;
let hasGeminiApiKeysConfigured = false;
let hasAssemblyAiApiKeyConfigured = false;
const aiActionInFlightState = {
    askAi: false,
    screenAi: false,
    suggest: false,
    notes: false,
    insights: false
};
const shortcutManager = createShortcutManager({ settingsShortcutsList });
const windowAdjustmentManager = createWindowAdjustmentManager({
    windowResizeHandles,
    chatContainer,
    minWindowWidth: MIN_WINDOW_WIDTH,
    minWindowHeight: MIN_WINDOW_HEIGHT,
    onViewportResize: () => {
        autoResizeManualInput();
    }
});
const chatUiManager = createChatUiManager({
    chatContainer,
    chatMessagesElement,
    chatComposer,
    chatManualInput,
    chatManualSend,
    messageStore,
    maxChatInputHeight: MAX_CHAT_INPUT_HEIGHT,
    escapeHtml: (value) => escapeHtml(value),
    updateUi: () => updateUI(),
    onMessagesChanged: (messages) => {
        chatMessagesArray = messages;
    },
    showFeedback: (message, type) => showFeedback(message, type),
    addMonitorLog: (...args) => addMonitorLog(...args)
});
const settingsPanelManager = createSettingsPanelManager({
    settingsPanel,
    settingAiProvider,
    geminiSettingsGroup,
    ollamaSettingsGroup,
    settingGeminiKey,
    toggleGeminiKeyVisibilityBtn,
    settingGeminiModel,
    settingProgrammingLanguage,
    settingOllamaBaseUrl,
    settingOllamaModel,
    settingOllamaModelSelect,
    fetchOllamaModelsBtn,
    settingAssemblyKey,
    toggleAssemblyKeyVisibilityBtn,
    settingAssemblyModel,
    settingWindowOpacity,
    settingWindowOpacityValue,
    applySettingsShortcutConfig: (settings) => applySettingsShortcutConfig(settings),
    showFeedback: (message, type) => showFeedback(message, type),
    onSettingsSaved: (settings) => {
        applyApiKeyAvailabilityFromSettings(settings);
        updateUI();
    }
});
const contextProfileManager = createContextProfileManager({
    openBtn: openContextProfileBtn,
    panel: contextProfilePanel,
    closeBtn: closeContextProfileBtn,
    saveBtn: saveContextProfileBtn,
    uploadPdfBtn: cpUploadPdfBtn,
    resumeStatus: cpResumeStatus,
    resumeTextEl: cpResumeText,
    strengthsEl: cpStrengths,
    weaknessesEl: cpWeaknesses,
    pastExperiencesEl: cpPastExperiences,
    additionalContextEl: cpAdditionalContext,
    showFeedback: (message, type) => showFeedback(message, type),
    onOpen: () => {
        togglePill3View(viewContextProfile);
    },
    onClose: () => {
        if (activePill3View === viewContextProfile) {
            togglePill3View(viewSettings); // return to settings when closed
        }
    }
});
const transcriptionManager = createTranscriptionManager({
    transcriptionSourceState,
    normalizeSourceRule: normalizeAssemblySource,
    sourceLabelRule: resolveSourceLabel,
    audioPipeline,
    transcriptBufferManager,
    chatMessagesElement,
    transcriptionToggle,
    sourceSystemToggle,
    sourceMicToggle,
    monitorMasterState: null,
    monitorStatusSystem: null,
    monitorStatusMic: null,
    monitorLiveSystem: null,
    monitorLiveMic: null,
    monitorLogList: null,
    addChatMessage: (type, content, options) => addChatMessage(type, content, options),
    showFeedback: (message, type) => showFeedback(message, type)
});

// PILL UI LOGIC
function setPillVisibility(pill, isVisible) {
    if (pill) {
        if (isVisible) {
            pill.classList.remove('hidden');
        } else {
            pill.classList.add('hidden');
        }
    }
}

function showPill3View(viewToShow) {
    [viewAnswer, viewChat, viewSettings, viewContextProfile].forEach(view => {
        if (view) view.classList.add('hidden');
    });
    if (viewToShow) {
        viewToShow.classList.remove('hidden');
        setPillVisibility(pill3Content, true);
    } else {
        setPillVisibility(pill3Content, false);
    }
}

let activePill3View = null;
function togglePill3View(view) {
    if (activePill3View === view) {
        activePill3View = null;
        showPill3View(null);
    } else {
        activePill3View = view;
        showPill3View(view);
    }
}

function updatePill2Transcript(text, isFinal) {
    if (!pill2TranscriptText) return;
    const cleanText = text ? text.trim() : '';
    if (!cleanText) return;
    
    pill2TranscriptText.innerHTML = '';
    const span = document.createElement('span');
    if (!isFinal) {
        span.className = 'muted';
    }
    span.textContent = cleanText;
    pill2TranscriptText.appendChild(span);
}

window.updatePill2Transcript = updatePill2Transcript; // expose for transcript callbacks

function updatePill2Visibility() {
    const isTranscribing = transcriptionSourceState.selectedSources.system || transcriptionSourceState.selectedSources.mic;
    setPillVisibility(pill2Listening, isTranscribing);
}
window.updatePill2Visibility = updatePill2Visibility;

// Initialize
async function init() {
    console.log('Initializing renderer with Pill-Based UI...');

    if (typeof window.electronAPI !== 'undefined') {
        console.log('electronAPI is available');
    } else {
        console.error('electronAPI not available');
        showFeedback('electronAPI not available', 'error');
    }

    const settings = await loadShortcutConfig();
    setupEventListeners();
    setupIpcListeners();
    setupWindowAdjustments();
    applyTheme(resolveInitialThemePreference(settings), { persist: false });
    if (settings?.windowOpacityLevel) {
        updateWindowOpacityValueLabel(settings.windowOpacityLevel);
    }
    updateUI();
    transcriptionManager.updateTranscriptionUI();
    transcriptionManager.renderMonitorState();
    startTimer();
    
    // UI Initialization
    setPillVisibility(pill1Controls, true);
    setPillVisibility(pill2Listening, false);
    setPillVisibility(pill3Content, false);
    
    // Pill Toggle Event Listeners
    chatModeBtn?.addEventListener('click', () => {
        togglePill3View(viewChat);
        chatModeBtn.classList.toggle('active', activePill3View === viewChat);
        settingsModeBtn?.classList.remove('active');
        analyzeBtn?.classList.remove('active');
    });

    settingsModeBtn?.addEventListener('click', () => {
        togglePill3View(viewSettings);
        settingsModeBtn.classList.toggle('active', activePill3View === viewSettings);
        chatModeBtn?.classList.remove('active');
        analyzeBtn?.classList.remove('active');
        if (activePill3View === viewSettings) {
            openSettings();
        }
    });

    analyzeBtn?.addEventListener('click', () => {
        if (activePill3View !== viewAnswer) {
            togglePill3View(viewAnswer);
        }
        analyzeBtn.classList.add('active');
        chatModeBtn?.classList.remove('active');
        settingsModeBtn?.classList.remove('active');
        
        // Trigger Ask AI logic immediately on opening this view if not already loading
        if (!isAnalyzing && hasAiContextFn()) {
            askAiWithSessionContext();
        }
    });

    const hasAiContextFn = () => {
        const aiBundle = buildFilteredAiContextBundle({ charBudget: AI_CONTEXT_CHAR_BUDGET, emitTruncationLog: false });
        return aiBundle.transcriptContext.length > 0 || aiBundle.enabledScreenshotIds.length > 0 || aiBundle.contextString.length > 0;
    };

    expandChatBtn?.addEventListener('click', () => {
        if (activePill3View !== viewChat) {
            togglePill3View(viewChat);
            chatModeBtn?.classList.add('active');
            analyzeBtn?.classList.remove('active');
            settingsModeBtn?.classList.remove('active');
        }
    });

    const pill3ClearBtn = document.getElementById('pill-3-clear-btn');
    const closePill3 = () => {
        if (activePill3View) {
            togglePill3View(activePill3View); // toggles it off
        }
        chatModeBtn?.classList.remove('active');
        settingsModeBtn?.classList.remove('active');
        analyzeBtn?.classList.remove('active');
    };

    clearBtn?.addEventListener('click', closePill3);
    pill3ClearBtn?.addEventListener('click', closePill3);

    document.body.style.visibility = 'visible';
    document.body.style.display = 'block';
    const app = document.getElementById('app');
    if (app) {
        app.style.visibility = 'visible';
        app.style.display = 'flex';
    }

    console.log('Renderer initialized');
    showFeedback('Ready - click transcription to start', 'success');
}

function updateWindowOpacityValueLabel(value) {
    settingsPanelManager.updateWindowOpacityValueLabel(value);
    
    if (settingWindowOpacity && settingWindowOpacity.value !== String(value)) {
        settingWindowOpacity.value = value;
    }
    
    if (quickWindowOpacity && quickWindowOpacity.value !== String(value)) {
        quickWindowOpacity.value = value;
    }
    
    if (window.applyWindowOpacityLevelCSS) {
        window.applyWindowOpacityLevelCSS(value);
    }
}

async function saveQuickOpacitySetting(level) {
    try {
        const settings = await window.electronAPI.getSettings();
        if (settings && !settings.error) {
            settings.windowOpacityLevel = level;
            await window.electronAPI.saveSettings(settings);
        }
    } catch (e) {
        console.error("Failed to save quick opacity", e);
    }
}

function parseThemePreference(theme) {
    return theme === THEME_DARK || theme === THEME_LIGHT ? theme : null;
}

function normalizeTheme(theme) {
    return theme === THEME_DARK ? THEME_DARK : THEME_LIGHT;
}

function loadStoredThemePreference() {
    try {
        const savedTheme = window.localStorage?.getItem(THEME_STORAGE_KEY) || '';
        return parseThemePreference(savedTheme) || THEME_LIGHT;
    } catch (error) {
        console.warn('Failed to read saved theme preference:', error);
        return THEME_LIGHT;
    }
}

function resolveInitialThemePreference(settings) {
    const settingsTheme = parseThemePreference(String(settings?.themePreference || '').trim().toLowerCase());
    if (settingsTheme) {
        saveThemePreference(settingsTheme);
        return settingsTheme;
    }

    return loadStoredThemePreference();
}

function saveThemePreference(theme) {
    try {
        window.localStorage?.setItem(THEME_STORAGE_KEY, normalizeTheme(theme));
    } catch (error) {
        console.warn('Failed to save theme preference:', error);
    }
}

function persistThemePreference(theme) {
    const normalizedTheme = normalizeTheme(theme);
    saveThemePreference(normalizedTheme);

    const setThemePreference = window.electronAPI?.setThemePreference;
    if (typeof setThemePreference === 'function') {
        setThemePreference(normalizedTheme).catch((error) => {
            console.warn('Failed to persist theme preference to app state:', error);
        });
    }
}

function updateThemeToggleUi() {
    if (!themeToggleBtn) {
        return;
    }

    const isDarkMode = activeTheme === THEME_DARK;
    const nextThemeLabel = isDarkMode ? 'light' : 'dark';
    const ariaLabel = `Switch to ${nextThemeLabel} mode`;

    themeToggleBtn.classList.toggle('is-dark', isDarkMode);
    themeToggleBtn.setAttribute('aria-pressed', isDarkMode ? 'true' : 'false');
    themeToggleBtn.setAttribute('aria-label', ariaLabel);
    themeToggleBtn.removeAttribute('title');
}

let currentWindowOpacityLevel = 10;

function applyTheme(theme, options = {}) {
    const { persist = true, announce = false } = options;
    activeTheme = normalizeTheme(theme);

    document.body.classList.toggle('theme-dark', activeTheme === THEME_DARK);
    document.documentElement.setAttribute('data-theme', activeTheme);
    updateThemeToggleUi();

    if (persist) {
        persistThemePreference(activeTheme);
    }

    if (announce) {
        showFeedback(activeTheme === THEME_DARK ? 'Dark mode enabled' : 'Light mode enabled', 'info');
    }

    if (window.applyWindowOpacityLevelCSS) {
        window.applyWindowOpacityLevelCSS(currentWindowOpacityLevel);
    }
}

function toggleThemeMode() {
    const nextTheme = activeTheme === THEME_DARK ? THEME_LIGHT : THEME_DARK;
    applyTheme(nextTheme, { persist: true, announce: true });
}

window.applyWindowOpacityLevelCSS = function(level) {
    const root = document.body;
    const clampedLevel = Math.min(Math.max(Number.parseInt(level, 10) || 10, 1), 10);
    currentWindowOpacityLevel = clampedLevel;
    const isDark = activeTheme === THEME_DARK;

    if (clampedLevel === 10) {
        if (isDark) {
            root.style.setProperty('--glass-shell-bg', 'rgba(10, 10, 10, 0.95)');
            root.style.setProperty('--glass-panel-bg', 'rgba(15, 15, 20, 0.95)');
        } else {
            root.style.setProperty('--glass-shell-bg', 'rgba(255, 255, 255, 0.95)');
            root.style.setProperty('--glass-panel-bg', 'rgba(255, 255, 255, 0.95)');
        }
    } else {
        const minAlpha = isDark ? 0.08 : 0.05;
        const maxAlpha = 0.85;
        const alpha = minAlpha + ((clampedLevel - 1) / 9) * (maxAlpha - minAlpha);
        
        if (isDark) {
            root.style.setProperty('--glass-shell-bg', `rgba(8, 14, 28, ${alpha})`);
            root.style.setProperty('--glass-panel-bg', `rgba(15, 23, 42, ${alpha})`);
        } else {
            root.style.setProperty('--glass-shell-bg', `rgba(255, 255, 255, ${alpha})`);
            root.style.setProperty('--glass-panel-bg', `rgba(255, 255, 255, ${alpha})`);
        }
    }
}

function applySettingsShortcutConfig(settings) {
    shortcutManager.applySettingsShortcutConfig(settings);
}

function isShortcutPressed(event, shortcutId) {
    return shortcutManager.isShortcutPressed(event, shortcutId);
}

function isAiActionInFlight(actionId) {
    return Boolean(aiActionInFlightState[actionId]);
}

function setAiActionInFlight(actionId, inFlight) {
    if (!Object.prototype.hasOwnProperty.call(aiActionInFlightState, actionId)) {
        return;
    }

    const nextValue = Boolean(inFlight);
    if (aiActionInFlightState[actionId] === nextValue) {
        return;
    }

    aiActionInFlightState[actionId] = nextValue;
    updateUI();
}

async function runAiActionWithLock(actionId, action) {
    if (isAiActionInFlight(actionId)) {
        return false;
    }

    setAiActionInFlight(actionId, true);
    try {
        await action();
        return true;
    } finally {
        setAiActionInFlight(actionId, false);
    }
}

let activeScreenAiStream = null;

function createStreamHandler(actionId) {
    let accumulatedText = '';
    let messageRecord = null;
    let removeChunkListener = null;
    let loadingHidden = false;

    function start(headingPrefix) {
        accumulatedText = headingPrefix || '';
        
        if (actionId === 'askAi') {
            const contentArea = document.getElementById('answer-content-area');
            if (contentArea) {
                contentArea.innerHTML = '';
            }
        } else {
            messageRecord = addChatMessage('ai-response', accumulatedText || '...');
        }

        removeChunkListener = window.electronAPI.onAiStreamChunk((data) => {
            if (data.actionId !== actionId) return;
            accumulatedText += data.text;
            
            if (actionId === 'askAi') {
                const contentArea = document.getElementById('answer-content-area');
                if (contentArea) {
                    contentArea.innerHTML = formatResponseHtml(accumulatedText);
                }
            } else if (messageRecord) {
                chatUiManager.updateChatMessageContent(messageRecord.id, accumulatedText);
            }
            if (!loadingHidden) {
                loadingHidden = true;
                hideLoadingOverlay();
            }
        });

        return messageRecord;
    }

    function finalize(finalText) {
        if (actionId === 'askAi') {
            const contentArea = document.getElementById('answer-content-area');
            if (contentArea) {
                contentArea.innerHTML = formatResponseHtml(finalText);
            }
        } else if (finalText && messageRecord) {
            chatUiManager.updateChatMessageContent(messageRecord.id, finalText);
        }
    }

    function cleanup() {
        if (removeChunkListener) {
            removeChunkListener();
            removeChunkListener = null;
        }
    }
    
    // Simple inline formatter for Answer Area
    function formatResponseHtml(text) {
        let safe = escapeHtml(text);
        safe = safe.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        safe = safe.replace(/\*(.*?)\*/g, '<em>$1</em>');
        safe = safe.replace(/\n/g, '<br>');
        return `<div class="font-body-base text-body-base text-on-surface leading-relaxed"><p class="mb-4">${safe}</p></div>`;
    }

    return { start, finalize, cleanup };
}

function hasConfiguredGeminiApiKeys(value) {
    const keys = String(value ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
    return keys.length > 0;
}

function hasConfiguredAssemblyAiApiKey(value) {
    return String(value ?? '').trim().length > 0;
}

function applyApiKeyAvailabilityFromSettings(settings) {
    if (!settings || typeof settings !== 'object') {
        hasGeminiApiKeysConfigured = false;
        hasAssemblyAiApiKeyConfigured = false;
        return;
    }

    // Ollama doesn't require API keys, so treat it as always configured
    if (settings.aiProvider === 'ollama') {
        hasGeminiApiKeysConfigured = true;
    } else if (typeof settings.hasGeminiApiKeys === 'boolean') {
        hasGeminiApiKeysConfigured = settings.hasGeminiApiKeys;
    } else {
        hasGeminiApiKeysConfigured = hasConfiguredGeminiApiKeys(settings.geminiApiKey);
    }

    if (typeof settings.hasAssemblyAiApiKey === 'boolean') {
        hasAssemblyAiApiKeyConfigured = settings.hasAssemblyAiApiKey;
    } else {
        hasAssemblyAiApiKeyConfigured = hasConfiguredAssemblyAiApiKey(settings.assemblyAiApiKey);
    }
}

async function loadShortcutConfig() {
    if (!window.electronAPI?.getSettings) {
        applyApiKeyAvailabilityFromSettings(null);
        return null;
    }

    try {
        const settings = await window.electronAPI.getSettings();
        applySettingsShortcutConfig(settings);
        applyApiKeyAvailabilityFromSettings(settings);
        return settings;
    } catch (error) {
        console.error('Failed to load shortcut config:', error);
        applyApiKeyAvailabilityFromSettings(null);
        return null;
    }
}

function setupWindowAdjustments() {
    windowAdjustmentManager.setupWindowAdjustments();
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function isMessageIncludedForAi(message) {
    return messageStore.isIncludedForAi(message);
}

function buildFilteredAiContextBundle({ charBudget = AI_CONTEXT_CHAR_BUDGET, emitTruncationLog = true } = {}) {
    return buildAiContextBundle({
        messages: chatMessagesArray,
        isMessageIncludedForAi,
        charBudget,
        emitTruncationLog,
        onTruncationLog: (dropped, budget) => {
            addMonitorLog(
                'info',
                'context-cap',
                `Trimmed ${dropped} older context message(s) to stay within ${budget} chars`
            );
        }
    });
}

function updateMessageAiToggleUi(message) {
    syncMessageAiToggleUi(chatMessagesElement, message);
}

function toggleChatMessageInclusion(messageId) {
    const message = messageStore.toggleInclusion(messageId);
    if (!message) return;

    chatMessagesArray = messageStore.getMessages();
    updateMessageAiToggleUi(message);
    updateUI();

    const stateText = message.includeInAi ? 'included in' : 'excluded from';
    addMonitorLog('info', 'ai-context-toggle', `Message ${stateText} AI context`, null, {
        id: message.id,
        type: message.type
    });
}

function addMonitorLog(level, event, message, source = null, meta = null, timestamp = Date.now()) {
    transcriptionManager.addMonitorLog(level, event, message, source, meta, timestamp);
}

function flushAllFinalTranscripts(reason = 'flush-all') {
    transcriptionManager.flushAllFinalTranscripts(reason);
}

function setSourceSelected(source, enabled) {
    return transcriptionManager.setSourceSelected(source, enabled);
}

async function toggleMasterTranscription() {
    if (!hasAssemblyAiApiKeyConfigured) {
        showFeedback('AssemblyAI API key missing. Add it in Settings.', 'error');
        return;
    }

    return transcriptionManager.toggleMasterTranscription();
}

// Screenshot functions
async function takeStealthScreenshot() {
    try {
        showFeedback('Taking screenshot...', 'info');
        await window.electronAPI.takeStealthScreenshot();
    } catch (error) {
        console.error('Screenshot error:', error);
        showFeedback('Screenshot failed', 'error');
    }
}

function buildAskAiContextPayload() {
    const bundle = buildFilteredAiContextBundle({ charBudget: AI_CONTEXT_CHAR_BUDGET, emitTruncationLog: true });
    return {
        mode: 'best-next-answer',
        contextString: bundle.contextString,
        transcriptContext: bundle.transcriptContext,
        sessionSummary: bundle.sessionSummary,
        enabledScreenshotIds: bundle.enabledScreenshotIds,
        screenshotCount: bundle.enabledScreenshotIds.length
    };
}

async function askAiAboutSpecificMessage(messageId) {
    if (!hasGeminiApiKeysConfigured) {
        showFeedback('Gemini API key missing. Add it in Settings.', 'error');
        return;
    }

    if (!window.electronAPI?.askAiWithSessionContext) {
        showFeedback('Feature not available', 'error');
        return;
    }

    const message = messageStore.findById(messageId);
    if (!message) return;

    const label = message.type === 'voice-system' ? 'Host' : 'You';
    const singleContext = `[${label}]: ${message.content}`;

    const payload = {
        mode: 'best-next-answer',
        contextString: singleContext,
        transcriptContext: singleContext,
        sessionSummary: '',
        enabledScreenshotIds: [],
        screenshotCount: 0
    };

    await runAiActionWithLock('askAi', async () => {
        const stream = createStreamHandler('askAi');
        try {
            setAnalyzing(true);
            showLoadingOverlay('Analyzing specific message...');
            
            const questionText = document.getElementById('answer-question-text');
            if (questionText) {
                questionText.innerHTML = `<span class="text-tertiary-container">Question:</span> ${escapeHtml(message.content)}`;
            }

            stream.start('');

            const result = await window.electronAPI.askAiWithSessionContext(payload);

            if (result?.success && result?.text) {
                stream.finalize(`${result.text}`);
                showFeedback('Ask AI ready', 'success');
            } else {
                throw new Error(result?.error || 'Ask AI failed');
            }
        } catch (error) {
            console.error('Ask AI error:', error);
            showFeedback('Ask AI failed', 'error');
            addChatMessage('system', `Error: ${error.message}`);
        } finally {
            stream.cleanup();
            setAnalyzing(false);
            hideLoadingOverlay();
        }
    });
}

async function askAiWithSessionContext() {
    if (!hasGeminiApiKeysConfigured) {
        showFeedback('Gemini API key missing. Add it in Settings.', 'error');
        return;
    }

    if (!window.electronAPI?.askAiWithSessionContext) {
        showFeedback('Feature not available', 'error');
        return;
    }

    const payload = buildAskAiContextPayload();
    if (!payload.contextString && payload.enabledScreenshotIds.length === 0) {
        showFeedback('No transcript or screenshots available yet', 'error');
        return;
    }

    await runAiActionWithLock('askAi', async () => {
        const stream = createStreamHandler('askAi');
        try {
            setAnalyzing(true);
            showLoadingOverlay('Analyzing full session context...');
            
            const questionText = document.getElementById('answer-question-text');
            if (questionText) {
                const heading = payload.enabledScreenshotIds.length > 0
                    ? 'Best Next Answer (Transcript + Screen)'
                    : 'Best Next Answer (Transcript)';
                questionText.innerHTML = `<span class="text-tertiary-container">Action:</span> ${heading}`;
            }
            
            stream.start('');

            const result = await window.electronAPI.askAiWithSessionContext(payload);

            if (result?.success && result?.text) {
                stream.finalize(`${result.text}`);
                showFeedback('Ask AI ready', 'success');
            } else {
                throw new Error(result?.error || 'Ask AI failed');
            }
        } catch (error) {
            console.error('Ask AI error:', error);
            showFeedback('Ask AI failed', 'error');
            addChatMessage('system', `Error: ${error.message}`);
        } finally {
            stream.cleanup();
            setAnalyzing(false);
            hideLoadingOverlay();
        }
    });
}

async function analyzeScreenshotsOnly() {
    if (!hasGeminiApiKeysConfigured) {
        showFeedback('Gemini API key missing. Add it in Settings.', 'error');
        return;
    }

    const bundle = buildFilteredAiContextBundle({ charBudget: AI_CONTEXT_CHAR_BUDGET, emitTruncationLog: true });
    if (bundle.enabledScreenshotIds.length === 0) {
        showFeedback('No enabled screenshots to analyze', 'error');
        return;
    }

    await runAiActionWithLock('screenAi', async () => {
        const stream = createStreamHandler('screenAi');
        activeScreenAiStream = stream;
        try {
            setAnalyzing(true);
            showLoadingOverlay('Analyzing screenshots...');
            stream.start('');

            await window.electronAPI.analyzeStealthWithContext({
                contextString: bundle.contextString,
                enabledScreenshotIds: bundle.enabledScreenshotIds
            });
        } catch (error) {
            console.error('Analysis error:', error);
            showFeedback('Analysis failed', 'error');
            setAnalyzing(false);
            hideLoadingOverlay();
            // Clean up on error since onAnalysisResult may not fire
            stream.cleanup();
            activeScreenAiStream = null;
        }
        // Don't cleanup in finally - onAnalysisResult handles it for success path
        // This avoids a race where the invoke resolves before the event is delivered
    });
}

async function clearStealthData() {
    try {
        await window.electronAPI.clearStealth();
        if (window.electronAPI.clearConversationHistory) {
            await window.electronAPI.clearConversationHistory();
        }
        screenshotsCount = 0;
        messageStore.clear();
        chatMessagesArray = messageStore.getMessages();
        chatMessagesElement.innerHTML = '';
        updateUI();
        showFeedback('Cleared', 'success');
    } catch (error) {
        console.error('Clear error:', error);
        showFeedback('Clear failed', 'error');
    }
}

async function emergencyHide() {
    try {
        await window.electronAPI.emergencyHide();
        showEmergencyOverlay();
    } catch (error) {
        console.error('Emergency hide error:', error);
    }
}

function openCloseConfirmation() {
    if (!closeConfirmationDialog) {
        closeApplication();
        return;
    }

    isCloseConfirmationOpen = true;
    closeConfirmationDialog.classList.remove('hidden');
    confirmCloseBtn?.focus();
}

function closeCloseConfirmation() {
    if (!closeConfirmationDialog) {
        return;
    }

    isCloseConfirmationOpen = false;
    closeConfirmationDialog.classList.add('hidden');
    closeAppBtn?.focus();
}

async function closeApplication() {
    try {
        console.log('Closing application...');
        flushAllFinalTranscripts('app-close');
        await window.electronAPI.closeApp();
    } catch (error) {
        console.error('Close application error:', error);
    }
}

// NEW CLUELY-STYLE FEATURES

async function getResponseSuggestions() {
    if (!hasGeminiApiKeysConfigured) {
        showFeedback('Gemini API key missing. Add it in Settings.', 'error');
        return;
    }

    if (!window.electronAPI || !window.electronAPI.suggestResponse) {
        showFeedback('Feature not available', 'error');
        return;
    }

    await runAiActionWithLock('suggest', async () => {
        const stream = createStreamHandler('suggest');
        try {
            showFeedback('Generating suggestions...', 'info');
            const bundle = buildFilteredAiContextBundle({ charBudget: AI_CONTEXT_CHAR_BUDGET, emitTruncationLog: true });
            const transcriptOnlyContext = String(bundle.transcriptContext || '').trim();
            if (!transcriptOnlyContext) {
                showFeedback('No enabled transcript context available for suggestions', 'error');
                return;
            }

            stream.start('\u{1F4A1} **What should I say?**\n\n');

            const result = await window.electronAPI.suggestResponse({
                context: bundle.sessionSummary || 'Current meeting conversation',
                contextString: transcriptOnlyContext
            });

            if (result.success && result.suggestions) {
                stream.finalize(`\u{1F4A1} **What should I say?**\n\n${result.suggestions}`);
                showFeedback('Suggestions generated', 'success');
            } else {
                throw new Error(result.error || 'Failed to generate suggestions');
            }
        } catch (error) {
            console.error('Error getting suggestions:', error);
            showFeedback('Failed to generate suggestions', 'error');
            addChatMessage('system', `Error: ${error.message}`);
        } finally {
            stream.cleanup();
        }
    });
}

async function generateMeetingNotes() {
    if (!hasGeminiApiKeysConfigured) {
        showFeedback('Gemini API key missing. Add it in Settings.', 'error');
        return;
    }

    if (!window.electronAPI || !window.electronAPI.generateMeetingNotes) {
        showFeedback('Feature not available', 'error');
        return;
    }

    await runAiActionWithLock('notes', async () => {
        const stream = createStreamHandler('notes');
        try {
            showFeedback('Generating meeting notes...', 'info');
            setAnalyzing(true);
            const bundle = buildFilteredAiContextBundle({ charBudget: AI_CONTEXT_CHAR_BUDGET, emitTruncationLog: true });
            if (!bundle.contextString) {
                showFeedback('No enabled context available for notes', 'error');
                return;
            }

            stream.start('\u{1F4DD} **Meeting Notes**\n\n');

            const result = await window.electronAPI.generateMeetingNotes({
                contextString: bundle.contextString
            });

            if (result.success && result.notes) {
                stream.finalize(`\u{1F4DD} **Meeting Notes**\n\n${result.notes}`);
                showFeedback('Meeting notes generated', 'success');
            } else {
                throw new Error(result.error || 'Failed to generate notes');
            }
        } catch (error) {
            console.error('Error generating notes:', error);
            showFeedback('Failed to generate notes', 'error');
            addChatMessage('system', `Error: ${error.message}`);
        } finally {
            stream.cleanup();
            setAnalyzing(false);
        }
    });
}

async function getConversationInsights() {
    if (!hasGeminiApiKeysConfigured) {
        showFeedback('Gemini API key missing. Add it in Settings.', 'error');
        return;
    }

    if (!window.electronAPI || !window.electronAPI.getConversationInsights) {
        showFeedback('Feature not available', 'error');
        return;
    }

    await runAiActionWithLock('insights', async () => {
        const stream = createStreamHandler('insights');
        try {
            showFeedback('Analyzing conversation...', 'info');
            setAnalyzing(true);
            const bundle = buildFilteredAiContextBundle({ charBudget: AI_CONTEXT_CHAR_BUDGET, emitTruncationLog: true });
            if (!bundle.contextString) {
                showFeedback('No enabled context available for insights', 'error');
                return;
            }

            stream.start('\u{1F4CA} **Conversation Insights**\n\n');

            const result = await window.electronAPI.getConversationInsights({
                contextString: bundle.contextString
            });

            if (result.success && result.insights) {
                stream.finalize(`\u{1F4CA} **Conversation Insights**\n\n${result.insights}`);
                showFeedback('Insights generated', 'success');
            } else {
                throw new Error(result.error || 'Failed to get insights');
            }
        } catch (error) {
            console.error('Error getting insights:', error);
            showFeedback('Failed to get insights', 'error');
            addChatMessage('system', `Error: ${error.message}`);
        } finally {
            stream.cleanup();
            setAnalyzing(false);
        }
    });
}

// SETTINGS FUNCTIONS

async function openSettings() {
    await settingsPanelManager.openSettings();
}

function closeSettings() {
    settingsPanelManager.closeSettings();
}

async function saveSettings() {
    const result = await settingsPanelManager.saveSettings();
    if (result?.success && result?.settings) {
        applyApiKeyAvailabilityFromSettings(result.settings);
        updateUI();
    }
}

// UI Helper functions
function setAnalyzing(analyzing) {
    isAnalyzing = analyzing;
    updateUI();
}

function updateUI() {
    if (screenshotCount) {
        screenshotCount.textContent = screenshotsCount;
    }

    const aiBundle = buildFilteredAiContextBundle({
        charBudget: AI_CONTEXT_CHAR_BUDGET,
        emitTruncationLog: false
    });
    const hasTranscriptContext = aiBundle.transcriptContext.length > 0;
    const hasEnabledScreenshots = aiBundle.enabledScreenshotIds.length > 0;
    const hasAiContext = hasTranscriptContext || hasEnabledScreenshots || aiBundle.contextString.length > 0;
    const canRunAiActions = hasGeminiApiKeysConfigured;
    const canRunTranscription = hasAssemblyAiApiKeyConfigured;
    const askAiInFlight = isAiActionInFlight('askAi');
    const screenAiInFlight = isAiActionInFlight('screenAi');
    const suggestInFlight = isAiActionInFlight('suggest');
    const notesInFlight = isAiActionInFlight('notes');
    const insightsInFlight = isAiActionInFlight('insights');

    if (analyzeBtn) {
        analyzeBtn.disabled = isAnalyzing || askAiInFlight || !canRunAiActions || !hasAiContext;
    }

    if (screenAiBtn) {
        screenAiBtn.disabled = isAnalyzing || screenAiInFlight || !canRunAiActions || !hasEnabledScreenshots;
    }

    if (suggestBtn) {
        suggestBtn.disabled = isAnalyzing || suggestInFlight || !canRunAiActions || !hasTranscriptContext;
    }

    if (notesBtn) {
        notesBtn.disabled = isAnalyzing || notesInFlight || !canRunAiActions || !hasAiContext;
    }

    if (insightsBtn) {
        insightsBtn.disabled = isAnalyzing || insightsInFlight || !canRunAiActions || !hasAiContext;
    }

    if (transcriptionToggle) {
        transcriptionToggle.disabled = !canRunTranscription;
    }

    if (sourceSystemToggle) {
        sourceSystemToggle.disabled = !canRunTranscription;
    }

    if (sourceMicToggle) {
        sourceMicToggle.disabled = !canRunTranscription;
    }
}

function showFeedback(message, type = 'info') {
    console.log(`Feedback (${type}):`, message);

    if (statusText) {
        statusText.textContent = message;
        statusText.className = `status-text ${type} show`;
        statusText.style.display = 'block';

        setTimeout(() => {
            statusText.classList.remove('show');
            setTimeout(() => {
                statusText.style.display = 'none';
            }, 300);
        }, 3000);
    }
}

function showLoadingOverlay(message = 'Analyzing screen...') {
    const generatingState = document.getElementById('answer-generating-state');
    const contentArea = document.getElementById('answer-content-area');
    
    if (generatingState && contentArea) {
        generatingState.classList.remove('hidden');
        contentArea.innerHTML = '';
        contentArea.classList.add('hidden');
    } else if (loadingOverlay) {
        // Fallback for older UI
        const loadingTextElement = loadingOverlay.querySelector('.loading-text');
        if (loadingTextElement) {
            loadingTextElement.innerHTML = message;
        }
        loadingOverlay.classList.remove('hidden');
    }
}

function hideLoadingOverlay() {
    const generatingState = document.getElementById('answer-generating-state');
    const contentArea = document.getElementById('answer-content-area');
    
    if (generatingState && contentArea) {
        generatingState.classList.add('hidden');
        contentArea.classList.remove('hidden');
    } else if (loadingOverlay) {
        loadingOverlay.classList.add('hidden');
        const loadingTextElement = loadingOverlay.querySelector('.loading-text');
        if (loadingTextElement) {
            loadingTextElement.innerHTML = 'Analyzing screen...';
        }
    }
}

function showEmergencyOverlay() {
    if (emergencyOverlay) {
        emergencyOverlay.classList.remove('hidden');
        setTimeout(() => {
            emergencyOverlay.classList.add('hidden');
        }, 2000);
    }
}

function hideResults() {
    if (resultsPanel) {
        resultsPanel.classList.add('hidden');
    }
}

async function writeTextToClipboard(text) {
    const value = String(text ?? '');

    if (navigator?.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(value);
            return;
        } catch (error) {
            console.warn('Clipboard API denied, using fallback copy path:', error);
        }
    }

    const copyListener = (event) => {
        event.preventDefault();
        if (event.clipboardData) {
            event.clipboardData.setData('text/plain', value);
        }
    };

    document.addEventListener('copy', copyListener, true);
    try {
        const copiedViaEvent = document.execCommand('copy');
        if (copiedViaEvent) {
            return;
        }
    } finally {
        document.removeEventListener('copy', copyListener, true);
    }

    const temporaryInput = document.createElement('textarea');
    temporaryInput.value = value;
    temporaryInput.setAttribute('readonly', '');
    temporaryInput.style.position = 'fixed';
    temporaryInput.style.left = '-9999px';
    temporaryInput.style.top = '0';
    document.body.appendChild(temporaryInput);
    temporaryInput.select();

    const copiedViaSelection = document.execCommand('copy');
    document.body.removeChild(temporaryInput);

    if (!copiedViaSelection) {
        throw new Error('Clipboard write failed');
    }
}

async function copyChatMessageById(messageId) {
    const message = messageStore.findById(messageId);
    const content = String(message?.content || '');

    if (!content.trim()) {
        showFeedback('Nothing to copy', 'error');
        return;
    }

    try {
        await writeTextToClipboard(content);
        showFeedback('Message copied', 'success');
    } catch (error) {
        console.error('Message copy error:', error);
        showFeedback('Copy failed', 'error');
    }
}

// Chat message management
function addChatMessage(type, content, options = {}) {
    return chatUiManager.addChatMessage(type, content, options);
}

function autoResizeManualInput() {
    chatUiManager.autoResizeManualInput();
}

function updateManualComposerState() {
    chatUiManager.updateManualComposerState();
}

function submitManualContextMessage() {
    chatUiManager.submitManualContextMessage();
}

// Timer
function startTimer() {
    const timerElement = document.querySelector('.timer');
    if (!timerElement) return;

    timerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
        const seconds = (elapsed % 60).toString().padStart(2, '0');
        timerElement.textContent = `${minutes}:${seconds}`;
    }, 1000);
}

// Event listeners
function setupEventListeners() {
    setupEventListenersModule({
        windowApi: window.electronAPI,
        screenshotBtn,
        analyzeBtn,
        screenAiBtn,
        clearBtn,
        hideBtn,
        chatManualSend,
        chatManualInput,
        closeResultsBtn,
        transcriptionToggle,
        sourceSystemToggle,
        sourceMicToggle,
        closeAppBtn,
        cancelCloseBtn,
        confirmCloseBtn,
        closeConfirmationDialog,
        chatMessagesElement,
        suggestBtn,
        notesBtn,
        insightsBtn,
        themeToggleBtn,
        clickThroughBtn,
        noFocusBtn,
        settingsBtn,
        closeSettingsBtn,
        saveSettingsBtn,
        settingWindowOpacity,
        quickWindowOpacity,
        saveQuickOpacitySetting,
        selectedSources,
        isCloseConfirmationOpen: () => isCloseConfirmationOpen,
        isShortcutPressed,
        updateWindowOpacityValueLabel,
        takeStealthScreenshot,
        askAiWithSessionContext,
        askAiAboutSpecificMessage,
        analyzeScreenshotsOnly,
        clearStealthData,
        emergencyHide,
        copyChatMessageById,
        writeTextToClipboard,
        submitManualContextMessage,
        autoResizeManualInput,
        updateManualComposerState,
        hideResults,
        toggleMasterTranscription,
        addMonitorLog,
        setSourceSelected,
        openCloseConfirmation,
        closeCloseConfirmation,
        closeApplication,
        toggleChatMessageInclusion,
        getResponseSuggestions,
        generateMeetingNotes,
        getConversationInsights,
        toggleThemeMode,
        openSettings,
        closeSettings,
        saveSettings
    });
}

// IPC listeners
function setupIpcListeners() {
    setupIpcListenersModule({
        windowApi: window.electronAPI,
        setScreenshotsCount: (nextCount) => {
            screenshotsCount = nextCount;
        },
        updateUi: updateUI,
        addChatMessage,
        setAnalyzing,
        showLoadingOverlay,
        hideLoadingOverlay,
        showFeedback,
        showEmergencyOverlay,
        transcriptionManager,
        toggleMasterTranscription,
        askAiWithSessionContext,
        isAskAiShortcutEnabled: () => Boolean(analyzeBtn && !analyzeBtn.disabled),
        addMonitorLog,
        getActiveScreenAiStream: () => activeScreenAiStream,
        clearActiveScreenAiStream: () => {
            if (activeScreenAiStream) {
                activeScreenAiStream.cleanup();
                activeScreenAiStream = null;
            }
        }
    });
}

// Initialize on load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}





