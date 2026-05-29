import { openSearchPanel } from "@codemirror/search";
import { EditorView } from "@codemirror/view";
import type { SerializedEnrichment } from "@posthog/shared";
import { Box, Flex, Text } from "@radix-ui/themes";
import { useEffect, useMemo } from "react";
import { setEnrichmentEffect } from "../extensions/postHogEnrichment";
import { useCodeMirror } from "../hooks/useCodeMirror";
import { useEditorExtensions } from "../hooks/useEditorExtensions";
import { usePendingScrollStore } from "../pendingScrollStore";

interface CodeMirrorEditorProps {
  content: string;
  filePath?: string;
  relativePath?: string;
  readOnly?: boolean;
  enrichment?: SerializedEnrichment | null;
}

export function CodeMirrorEditor({
  content,
  filePath,
  relativePath,
  readOnly = false,
  enrichment,
}: CodeMirrorEditorProps) {
  const enrichmentEnabled = enrichment !== undefined;
  const extensions = useEditorExtensions(filePath, readOnly, enrichmentEnabled);
  const options = useMemo(
    () => ({ doc: content, extensions, filePath }),
    [content, extensions, filePath],
  );
  const { containerRef, instanceRef } = useCodeMirror(options);

  useEffect(() => {
    if (!enrichmentEnabled) return;
    const view = instanceRef.current;
    if (!view) return;
    view.dispatch({
      effects: setEnrichmentEffect.of(enrichment ?? null),
    });
  }, [enrichment, enrichmentEnabled, instanceRef]);

  useEffect(() => {
    if (!filePath) return;
    const scrollToLine = () => {
      const line = usePendingScrollStore.getState().pendingLine[filePath];
      if (line === undefined) return;
      const view = instanceRef.current;
      if (!view) return;
      usePendingScrollStore.getState().consumeScroll(filePath);
      const lineCount = view.state.doc.lines;
      if (line < 1 || line > lineCount) return;
      const lineInfo = view.state.doc.line(line);
      view.dispatch({
        selection: { anchor: lineInfo.from },
        effects: EditorView.scrollIntoView(lineInfo.from, { y: "center" }),
      });
    };
    const rafId = requestAnimationFrame(scrollToLine);
    const unsub = usePendingScrollStore.subscribe(scrollToLine);
    return () => {
      cancelAnimationFrame(rafId);
      unsub();
    };
  }, [filePath, instanceRef]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== "f") return;

      const instance = instanceRef.current;
      if (!instance || !(instance instanceof EditorView)) return;

      e.preventDefault();
      e.stopPropagation();
      openSearchPanel(instance);
    };

    document.addEventListener("keydown", handleKeyDown, { capture: true });
    return () =>
      document.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [instanceRef]);

  if (!relativePath) {
    return <div ref={containerRef} className="h-full w-full" />;
  }

  return (
    <Flex direction="column" height="100%">
      <Box px="3" py="2" className="shrink-0 border-b border-b-(--gray-6)">
        <Text
          color="gray"
          className="font-[var(--code-font-family)] text-[13px]"
        >
          {relativePath}
        </Text>
      </Box>
      <Box className="flex-1 overflow-auto">
        <div ref={containerRef} className="h-full w-full" />
      </Box>
    </Flex>
  );
}
