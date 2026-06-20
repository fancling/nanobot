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

const READABLE_BLOCK_SELECTOR = "p,h1,h2,h3,h4,h5,h6,li,blockquote,pre";

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

function hasReadableBlockAncestor(block: Element, root: Element): boolean {
  let ancestor = block.parentElement;
  while (ancestor && ancestor !== root.parentElement) {
    if (ancestor !== root && ancestor.matches(READABLE_BLOCK_SELECTOR)) {
      return true;
    }
    if (ancestor === root) {
      return false;
    }
    ancestor = ancestor.parentElement;
  }
  return false;
}

function textFromLoadedContent(content: Document | Element | { body?: { textContent?: string | null } }): string {
  const root = readableRootFromContent(content);
  if (root) {
    const blocks = [
      ...(root.matches(READABLE_BLOCK_SELECTOR) ? [root] : []),
      ...Array.from(root.querySelectorAll(READABLE_BLOCK_SELECTOR)),
    ].filter((block) => !hasReadableBlockAncestor(block, root));
    const blockText = blocks.map((block) => normalizeWhitespace(block.textContent ?? "")).filter(Boolean);
    if (blockText.length > 0) {
      return blockText.join("\n\n");
    }
    return root.textContent ?? "";
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
