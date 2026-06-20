import type { ReadingSnapshot } from "@/lib/types";

export const READER_STATE_STORAGE_PREFIX = "nanobot.webui.readerShell.v1:";

export interface ReaderParagraph {
  id: string;
  text: string;
  index: number;
}

export type ReaderDocumentKind = "text" | "markdown" | "epub";

export interface ReaderSection {
  id: string;
  title: string;
  rawText: string;
  paragraphCount: number;
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
  documentKind?: ReaderDocumentKind;
  readerModeOpen?: boolean;
  readerSession?: boolean;
  sourceFileName?: string;
  sections?: ReaderSection[];
  activeSectionIndex?: number;
}

export interface ReaderStateLoadResult {
  state: ReaderState | null;
  storageFailed: boolean;
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
  return typeof value === "number" && Number.isInteger(value) ? value : fallback;
}

function normalizeDocumentKind(value: unknown): ReaderDocumentKind {
  return value === "text" || value === "markdown" || value === "epub"
    ? value
    : "markdown";
}

function normalizeReaderSections(value: unknown): ReaderSection[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const sections = value.filter((section): section is ReaderSection => {
    if (typeof section !== "object" || section === null) return false;
    const maybe = section as Record<string, unknown>;
    return (
      typeof maybe.id === "string"
      && maybe.id.length > 0
      && typeof maybe.title === "string"
      && maybe.title.length > 0
      && typeof maybe.rawText === "string"
      && maybe.rawText.trim().length > 0
      && typeof maybe.paragraphCount === "number"
      && Number.isInteger(maybe.paragraphCount)
      && maybe.paragraphCount >= 0
    );
  }).map((section) => ({
    id: section.id,
    title: section.title,
    rawText: section.rawText,
    paragraphCount: section.paragraphCount,
  }));

  return sections.length > 0 ? sections : undefined;
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

function parseReaderStatePayload(parsed: unknown): ReaderState | null {
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const maybe = parsed as Record<string, unknown>;

  if (maybe.version !== 1 || typeof maybe.rawText !== "string") {
    return null;
  }

  const readerSession = maybe.readerSession === true;
  const sourceFileName = normalizeText(maybe.sourceFileName);
  const sections = normalizeReaderSections(maybe.sections);

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
    documentKind: normalizeDocumentKind(maybe.documentKind),
    readerModeOpen: maybe.readerModeOpen === true,
    readerSession,
    sourceFileName: sourceFileName || undefined,
    sections,
    activeSectionIndex: normalizeInt(maybe.activeSectionIndex, 0),
  };
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

export function getActiveReaderSection(state: ReaderState): ReaderSection | null {
  const sections = Array.isArray(state.sections) ? state.sections : [];
  if (sections.length === 0) return null;
  const index = Math.max(0, Math.min(normalizeInt(state.activeSectionIndex, 0), sections.length - 1));
  return sections[index] ?? null;
}

export function getActiveReaderText(state: ReaderState): string {
  return getActiveReaderSection(state)?.rawText ?? state.rawText;
}

export function isReaderSessionState(state: ReaderState | null): boolean {
  return state?.readerSession === true;
}

export function buildReadingSnapshot(state: ReaderState): ReadingSnapshot {
  const normalizedTitle = normalizeText(state.title);
  const normalizedQuestion = normalizeText(state.question);
  const normalizedNote = normalizeText(state.note);
  const normalizedRaw = normalizeText(getActiveReaderText(state));
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
      kind: normalizeDocumentKind(state.documentKind),
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

export function saveReaderState(chatId: string, state: ReaderState): boolean {
  const storage = storageAvailable();
  if (!storage) return false;
  const key = getStorageKey(chatId);
  try {
    storage.setItem(key, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function loadReaderStateResult(chatId: string): ReaderStateLoadResult {
  const storage = storageAvailable();
  if (!storage) return { state: null, storageFailed: true };
  const key = getStorageKey(chatId);
  try {
    const raw = storage.getItem(key);
    if (!raw) return { state: null, storageFailed: false };

    const state = parseReaderStatePayload(JSON.parse(raw));

    return {
      state,
      storageFailed: false,
    };
  } catch {
    return { state: null, storageFailed: true };
  }
}

export function loadReaderState(chatId: string): ReaderState | null {
  return loadReaderStateResult(chatId).state;
}

export function loadReaderSessionChatIdSet(): Set<string> {
  const storage = storageAvailable();
  if (!storage) return new Set();

  const readerSessionChatIds = new Set<string>();

  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key?.startsWith(READER_STATE_STORAGE_PREFIX)) {
        continue;
      }

      try {
        const raw = storage.getItem(key);
        if (!raw) {
          continue;
        }

        const state = parseReaderStatePayload(JSON.parse(raw));
        if (!state) {
          continue;
        }

        if (state.readerSession === true) {
          readerSessionChatIds.add(key.slice(READER_STATE_STORAGE_PREFIX.length));
        }
      } catch {
        continue;
      }
    }
  } catch {
    return new Set();
  }

  return readerSessionChatIds;
}
