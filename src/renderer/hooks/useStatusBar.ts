import { useStatusBarStore } from "@stores/statusBarStore";
import { useEffect, useRef } from "react";

interface KeyHint {
  keys: string[];
  description: string;
}

export function useStatusBar(
  statusText: string,
  keyHints: KeyHint[],
  mode: "replace" | "append" = "replace",
) {
  const { setStatusBar, reset } = useStatusBarStore();
  const keyHintsJson = JSON.stringify(keyHints);
  const lastConfigJson = useRef<string>("");

  useEffect(() => {
    const configJson = JSON.stringify({
      statusText,
      keyHints: keyHintsJson,
      mode,
    });

    if (configJson !== lastConfigJson.current) {
      lastConfigJson.current = configJson;
      setStatusBar({ statusText, keyHints, mode });
    }
  }, [statusText, keyHintsJson, mode, keyHints, setStatusBar]);

  useEffect(() => {
    return reset;
  }, [reset]);
}
