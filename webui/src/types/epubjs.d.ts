declare module "epubjs" {
  type EpubRequestFunction = (...args: unknown[]) => Promise<unknown>;

  interface EpubSpineItem {
    load: (request: EpubRequestFunction) => Promise<Document | Element | { body?: { textContent?: string | null } }>;
    unload?: () => void;
  }

  interface EpubBook {
    load: EpubRequestFunction;
    loaded: {
      metadata: Promise<{ title?: string | null }>;
      spine: Promise<{ items?: EpubSpineItem[] }>;
    };
  }

  export default function ePub(input: ArrayBuffer): EpubBook;
}
