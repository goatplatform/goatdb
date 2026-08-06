import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

async function copyToClipboard(text: string): Promise<void> {
  // The clipboard API is only defined in secure contexts (HTTPS / localhost).
  // Lazily fall back to copy-text-to-clipboard for plain HTTP.
  if (navigator.clipboard) {
    return navigator.clipboard.writeText(text);
  }
  const { default: copy } = await import('copy-text-to-clipboard');
  copy(text);
}

export type CopyState = { isCopied: boolean; copy: () => void };

// Shared between the swizzled Container (whole tile is the copy target) and
// CopyButton (icon flips to Check): one state, two interaction surfaces.
export const CopyStateContext = createContext<CopyState | null>(null);

export function useCopyState(code: string): CopyState {
  const [isCopied, setIsCopied] = useState(false);
  const copyTimeout = useRef<number | undefined>(undefined);

  const copy = useCallback(() => {
    copyToClipboard(code).then(() => {
      setIsCopied(true);
      copyTimeout.current = window.setTimeout(() => setIsCopied(false), 1500);
    });
    // Errors are intentionally not caught so they remain visible to
    // observability tooling instead of failing silently.
  }, [code]);

  useEffect(() => () => window.clearTimeout(copyTimeout.current), []);
  return { isCopied, copy };
}

export function useCopyStateContext(): CopyState {
  const state = useContext(CopyStateContext);
  if (!state) {
    throw new Error('CopyStateContext missing: not inside a code block Container');
  }
  return state;
}
