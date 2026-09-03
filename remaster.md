# Redesign Prompt: Pill-Based Overlay UI for Interview Assistant

You are redesigning a floating, always-on-top Windows interview-assistant overlay. Replace the current design (persistent panel, visible resize handles, an always-open "AI assistant" window) with a new **pill-based system**: compact, rounded, collapsible bars that appear only when needed and stack vertically as more are opened.

## Core principle
- Only **one pill is visible by default** — a single, non-resizable top pill with no resize handles or extra chrome.
- No static/persistent windows. Every other pill is transient — it appears in response to user action and can be dismissed.
- Up to three pills can be visible at once, stacked top to bottom:
  **Pill 1 (Controls) → Pill 2 (Listening / Transcript) → Pill 3 (Answer / Chat / Settings)**

## State 1 — Default: Pill 1 (Controls)
Always visible. Left to right:
1. **Mute Host** toggle
2. **Mute User** toggle
3. **Assembly/connection status** icon-button — missing from the current reference design; add it here in the same visual language
4. **Answer** — same function as the existing "Ask AI," same keyboard shortcut. Triggers a new loading animation that appears only inside Pill 3's Q&A/chat view
5. **Screenshot** — same functionality and shortcut as the current build
6. **Chat** — toggles Pill 3 in Chat mode
7. **Move** *(new)* — lets the user drag/reposition the whole app
8. **Pin** — toggles click-through mode
9. **Settings** — opens Pill 3 in Settings mode

## State 2 — Pill 2: Listening / Transcript
Appears only when Mute Host or Mute User is pressed. Contains:
- Last transcript line, centered
- **Clear** button, right-aligned — clears and closes Pill 3, whichever mode it's in (Answer or Chat)
- **Expand** button — increases the size of the transcript/chat view

## State 3 — Pill 3: Answer / Chat / Settings
Same slot, reused across three modes. Opens directly below whatever pills are already open (below Pill 1, or below Pill 1 + Pill 2).

- **Answer mode** (from the Answer button): runs the existing Ask-AI flow; shows the response, with the new loading animation while generating.
- **Chat mode** (from the Chat button): shows the full running conversation/context — everything currently in the persistent "AI assistant" window, restyled to the new language — plus a text input so the user can type and send new messages. This fully replaces the old always-on panel; it's now toggleable.
- **Settings mode** (from the Settings button): full settings panel, redesigned in the new pill language.
- **Opacity controls** are only exposed once Pill 3 is open, in any mode — not available in the default single-pill state.

## Feature parity
- Ask AI and Screenshot carry over 1:1, including their current keyboard shortcuts.
- The persistent "AI assistant" window is retired in favor of the toggleable Chat pill.
- *[Fill in: list any other current features to temporarily disable under the new design language]*

## Visual language
- Continue the dark, fully-rounded "pill" aesthetic — low-height bars, subtle elevation/shadow, icon-first buttons, minimal text.
- Show Windows-style keyboard-shortcut labels next to actionable buttons where applicable (app remains Windows-first for now).
- Pills should animate in/out (slide + fade) rather than snap, since they're now transient instead of static.