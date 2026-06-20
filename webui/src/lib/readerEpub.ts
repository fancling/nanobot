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

function textFromLoadedContent(content: Document | Element | { body?: { textContent?: string | null } }): string {
  if ("body" in content && content.body?.textContent) {
    return content.body.textContent;
  }
  if ("textContent" in content && typeof content.textContent === "string") {
    return content.textContent;
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
      const loaded = await item.load(book);
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
