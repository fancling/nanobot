import ePub from "epubjs";

import type { ReaderDocumentKind } from "@/lib/reading";

export interface ImportedReaderDocument {
  documentId: string;
  title: string;
  rawText: string;
  documentKind: ReaderDocumentKind;
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

export async function importEpubDocument(file: File): Promise<ImportedReaderDocument> {
  const buffer = await file.arrayBuffer();
  const book = ePub(buffer);
  const [metadata, spine] = await Promise.all([book.loaded.metadata, book.loaded.spine]);
  const title = metadata.title?.trim() || file.name.replace(/\.epub$/i, "") || "Untitled EPUB";
  const parts: string[] = [];

  for (const item of spine.items ?? []) {
    try {
      const loaded = await item.load(book.load.bind(book));
      const text = normalizeWhitespace(textFromLoadedContent(loaded));
      if (text) {
        parts.push(text);
      }
    } finally {
      item.unload?.();
    }
  }

  const rawText = normalizeWhitespace(parts.join("\n\n"));
  if (!rawText) {
    throw new Error("No readable text found in EPUB.");
  }

  return {
    documentId: crypto.randomUUID(),
    title,
    rawText,
    documentKind: "epub",
  };
}
