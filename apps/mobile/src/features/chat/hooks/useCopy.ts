import * as Clipboard from "expo-clipboard";
import { useCallback, useRef, useState } from "react";

export function useCopy(resetMs = 2000): {
  copied: boolean;
  copy: (text: string) => void;
} {
  const [copied, setCopied] = useState(false);
  const timeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  const copy = useCallback(
    (text: string) => {
      Clipboard.setStringAsync(text).then(
        () => {
          setCopied(true);
          clearTimeout(timeout.current);
          timeout.current = setTimeout(() => setCopied(false), resetMs);
        },
        () => {},
      );
    },
    [resetMs],
  );

  return { copied, copy };
}
