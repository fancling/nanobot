import ePub from "epubjs";

import type { ReaderDocumentKind, ReaderSection } from "@/lib/reading";
import { parseReaderParagraphs } from "@/lib/reading";

export interface ImportedReaderDocument {
  documentId: string;
  title: string;
  rawText: string;
  documentKind: ReaderDocumentKind;
  readerSession: true;
  sourceFileName: string;
  sections: ReaderSection[];
  activeSectionIndex: 0;
}

function normalizeWhitespace(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const BLOCK_BOUNDARY_ELEMENTS = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "DD",
  "DIV",
  "DL",
  "DT",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "HR",
  "LI",
  "MAIN",
  "NAV",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "TABLE",
  "TBODY",
  "TD",
  "TFOOT",
  "TH",
  "THEAD",
  "TR",
  "UL",
]);

type LoadedEpubContent = Document | Element | { body?: { textContent?: string | null } };
type EpubSection = {
  load: (request: (...args: unknown[]) => Promise<unknown>) => Promise<LoadedEpubContent>;
  unload?: () => void;
};

function isDocument(value: LoadedEpubContent): value is Document {
  return typeof value === "object" && value !== null && "nodeType" in value && value.nodeType === 9;
}

function isElement(value: LoadedEpubContent): value is Element {
  return typeof value === "object" && value !== null && "nodeType" in value && value.nodeType === 1;
}

function readableRootFromContent(content: LoadedEpubContent): Element | null {
  if (isDocument(content)) {
    return content.body ?? content.documentElement;
  }
  if (isElement(content)) {
    return content.querySelector("body") ?? content;
  }
  return null;
}

function textFromLoadedContent(content: Document | Element | { body?: { textContent?: string | null } }): string {
  const root = readableRootFromContent(content);
  if (root) {
    const parts: string[] = [];
    let current = "";

    const flush = () => {
      const text = normalizeWhitespace(current);
      if (text) {
        parts.push(text);
      }
      current = "";
    };

    const walk = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        current += node.textContent ?? "";
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) {
        return;
      }

      const element = node as Element;
      const tagName = element.tagName.toUpperCase();
      if (tagName === "BR") {
        flush();
        return;
      }

      const isBlockBoundary = BLOCK_BOUNDARY_ELEMENTS.has(tagName);
      if (isBlockBoundary) {
        flush();
      }
      element.childNodes.forEach(walk);
      if (isBlockBoundary) {
        flush();
      }
    };

    walk(root);
    flush();
    return parts.length > 0 ? parts.join("\n\n") : (root.textContent ?? "");
  }
  if ("body" in content && content.body?.textContent) {
    return content.body.textContent;
  }
  return "";
}

function loadableSections(spine: { spineItems?: EpubSection[]; items?: unknown[] }): EpubSection[] {
  if (Array.isArray(spine.spineItems)) {
    return spine.spineItems;
  }
  if (!Array.isArray(spine.items)) {
    return [];
  }
  return spine.items.filter((item): item is EpubSection => (
    typeof item === "object"
    && item !== null
    && "load" in item
    && typeof item.load === "function"
  ));
}

export async function importEpubDocument(file: File): Promise<ImportedReaderDocument> {
  const buffer = await file.arrayBuffer();
  const book = ePub(buffer);
  const [metadata, spine] = await Promise.all([book.loaded.metadata, book.loaded.spine]);
  const title = metadata.title?.trim() || file.name.replace(/\.epub$/i, "") || "Untitled EPUB";
  const sections: ReaderSection[] = [];
  let sectionIndex = 0;

  for (const item of loadableSections(spine)) {
    try {
      const loaded = await item.load(book.load.bind(book));
      const rawText = normalizeWhitespace(textFromLoadedContent(loaded));
      if (rawText) {
        sections.push({
          id: `section-${sectionIndex}`,
          title: `Chapter ${sectionIndex + 1}`,
          rawText,
          paragraphCount: parseReaderParagraphs(rawText).length,
        });
        sectionIndex += 1;
      }
    } finally {
      item.unload?.();
    }
  }

  if (sections.length === 0) {
    throw new Error("No readable text found in EPUB.");
  }

  return {
    documentId: crypto.randomUUID(),
    title,
    rawText: sections[0].rawText,
    documentKind: "epub",
    readerSession: true,
    sourceFileName: file.name,
    sections,
    activeSectionIndex: 0,
  };
}
