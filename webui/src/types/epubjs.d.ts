declare module "epubjs" {
  interface EpubSpineItem {
    load: (book: unknown) => Promise<Document | Element | { body?: { textContent?: string | null } }>;
    unload?: () => void;
  }

  interface EpubBook {
    loaded: {
      metadata: Promise<{ title?: string | null }>;
      spine: Promise<{ items?: EpubSpineItem[] }>;
    };
  }

  export default function ePub(input: ArrayBuffer): EpubBook;
}
