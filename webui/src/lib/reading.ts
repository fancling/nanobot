export const READER_STATE_STORAGE_PREFIX = "nanobot.webui.readerShell.v1:";

export interface ReaderParagraph {
  id: string;
  text: string;
  index: number;
}

export interface ReaderState {
  version: 1;
  documentId: string;
  title: string;
  rawText: string;
  focusedParagraphIndex: number;
  selectedText: string;
  note: string;
  question: string;
  mode: "slow_reading";
  collapsed: boolean;
}

export interface ReadingSnapshot {
  version: 1;
  scene: "reading";
  document: {
    id: string;
    title: string;
    kind: "markdown";
  };
  location: {
    paragraph_index: number;
    paragraph_count: number;
    progress_label: "single passage" | "early document" | "middle document" | "late document";
  };
  focus: {
    focused_text: string;
    selected_text: string | null;
    before: string;
    after: string;
    user_note: string;
    current_question: string;
  };
  reading_state: {
    mode: ReaderState["mode"];
    engagement: "focused_reading" | "actively_reflecting";
  };
  prediction: {
    likely_need: string;
    bad_response_risk: string;
  };
}

const TITLE_MAX_CHARS = 240;
const FOCUSED_TEXT_MAX_CHARS = 1200;
const SELECTED_TEXT_MAX_CHARS = 800;
const CONTEXT_TEXT_MAX_CHARS = 600;
const NOTE_MAX_CHARS = 800;
const QUESTION_MAX_CHARS = 400;
const PREDICTION_MAX_CHARS = 400;
const BAD_RESPONSE_RISK = "avoid generic summary";

function trimWithEllipsis(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars).trimEnd()}...`;
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeInt(value: unknown, fallback: number): number {
  return Number.isInteger(value) ? value : fallback;
}

function predictNeed(question: string): string {
  if (question.length > 0) {
    return `answer the user's question: ${question}`;
  }
  return "connect passage to user reflection";
}

function progressLabel(index: number, count: number): ReadingSnapshot["location"]["progress_label"] {
  if (count <= 1) return "single passage";
  const earlyBoundary = Math.floor(count * 0.33);
  const lateBoundary = Math.ceil(count * 0.67);
  if (index <= earlyBoundary) return "early document";
  if (index >= lateBoundary) return "late document";
  return "middle document";
}

function getStorageKey(chatId: string): string {
  return `${READER_STATE_STORAGE_PREFIX}${chatId}`;
}

function storageAvailable(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function parseReaderParagraphs(rawText: string): ReaderParagraph[] {
  const normalized = rawText.replace(/\r\n/g, "\n");
  const blocks = normalized.split(/\n\s*\n/g)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);

  return blocks.map((text, index) => ({
    id: `p-${index}`,
    text,
    index,
  }));
}

export function buildReadingSnapshot(state: ReaderState): ReadingSnapshot {
  const normalizedTitle = normalizeText(state.title);
  const normalizedQuestion = normalizeText(state.question);
  const normalizedNote = normalizeText(state.note);
  const normalizedRaw = normalizeText(state.rawText);
  const normalizedSelected = normalizeText(state.selectedText);

  const paragraphs = parseReaderParagraphs(normalizedRaw);
  const paragraphCount = Math.max(1, paragraphs.length);
  const focusedIndex = Math.max(
    0,
    Math.min(
      normalizeInt(state.focusedParagraphIndex, 0),
      paragraphCount - 1,
    ),
  );

  const focusedParagraph = paragraphs[focusedIndex]?.text ?? normalizedRaw;
  const before = paragraphs[focusedIndex - 1]?.text ?? "";
  const after = paragraphs[focusedIndex + 1]?.text ?? "";
  const trimmedFocusedParagraph = normalizeText(focusedParagraph);

  const title = trimWithEllipsis(normalizedTitle, TITLE_MAX_CHARS);
  const focusedText = trimWithEllipsis(trimmedFocusedParagraph, FOCUSED_TEXT_MAX_CHARS);
  const selectedText = normalizedSelected.length > 0
    ? trimWithEllipsis(normalizedSelected, SELECTED_TEXT_MAX_CHARS)
    : null;
  const beforeText = trimWithEllipsis(before, CONTEXT_TEXT_MAX_CHARS);
  const afterText = trimWithEllipsis(after, CONTEXT_TEXT_MAX_CHARS);
  const userNote = trimWithEllipsis(normalizedNote, NOTE_MAX_CHARS);
  const currentQuestion = trimWithEllipsis(normalizedQuestion, QUESTION_MAX_CHARS);
  const likelyNeed = trimWithEllipsis(
    predictNeed(normalizedQuestion),
    PREDICTION_MAX_CHARS,
  );
  const badResponseRisk = trimWithEllipsis(BAD_RESPONSE_RISK, PREDICTION_MAX_CHARS);
  const engagement = normalizedNote.length > 0 || normalizedQuestion.length > 0
    ? "actively_reflecting"
    : "focused_reading";

  return {
    version: 1,
    scene: "reading",
    document: {
      id: state.documentId,
      title,
      kind: "markdown",
    },
    location: {
      paragraph_index: focusedIndex,
      paragraph_count: paragraphCount,
      progress_label: progressLabel(focusedIndex, paragraphCount),
    },
    focus: {
      focused_text: focusedText,
      selected_text: selectedText,
      before: beforeText,
      after: afterText,
      user_note: userNote,
      current_question: currentQuestion,
    },
    reading_state: {
      mode: state.mode,
      engagement,
    },
    prediction: {
      likely_need: likelyNeed,
      bad_response_risk: badResponseRisk,
    },
  };
}

export function saveReaderState(chatId: string, state: ReaderState): void {
  const storage = storageAvailable();
  if (!storage) return;
  const key = getStorageKey(chatId);
  try {
    storage.setItem(key, JSON.stringify(state));
  } catch {
    // ignore storage failures in restricted/private modes
  }
}

export function loadReaderState(chatId: string): ReaderState | null {
  const storage = storageAvailable();
  if (!storage) return null;
  const key = getStorageKey(chatId);
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const maybe = parsed as Record<string, unknown>;

    if (maybe.version !== 1 || typeof maybe.rawText !== "string") return null;

    return {
      version: 1,
      documentId:
        typeof maybe.documentId === "string"
          ? maybe.documentId
          : "",
      title: normalizeText(maybe.title),
      rawText: maybe.rawText,
      focusedParagraphIndex: normalizeInt(maybe.focusedParagraphIndex, 0),
      selectedText: normalizeText(maybe.selectedText),
      note: normalizeText(maybe.note),
      question: normalizeText(maybe.question),
      mode: maybe.mode === "slow_reading" ? maybe.mode : "slow_reading",
      collapsed: maybe.collapsed === true,
    };
  } catch {
    return null;
  }
}
