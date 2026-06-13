import { isNonEmptySpec } from "@json-render/core";
import { PaperPlaneRightIcon, SpinnerGapIcon } from "@phosphor-icons/react";
import { Button } from "@posthog/quill";
import { useCanvasTemplates } from "@posthog/ui/features/canvas/hooks/useCanvasTemplates";
import {
  useCanvasChatStore,
  useCanvasThread,
} from "@posthog/ui/features/canvas/stores/canvasChatStore";
import { Box, Flex, ScrollArea, Text, TextArea } from "@radix-ui/themes";
import { useEffect, useRef, useState } from "react";

// Chat panel hugging the right of the canvas: a thread plus a composer that
// drives the canvas generation agent.
export function CanvasChat({ threadId }: { threadId: string }) {
  const { messages, isStreaming, lastTool, error, templateId, spec } =
    useCanvasThread(threadId);
  const send = useCanvasChatStore((s) => s.send);
  const templates = useCanvasTemplates();
  // Suggestions only while the canvas itself is still empty (nothing built yet).
  const suggestions = isNonEmptySpec(spec)
    ? []
    : (templates.find((t) => t.id === templateId)?.suggestions ?? []);

  const [draft, setDraft] = useState("");
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Drop a suggestion into the composer and focus it (ready to edit or send).
  const fillSuggestion = (text: string) => {
    setDraft(text);
    inputRef.current?.focus();
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on new content
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, lastTool]);

  const submit = () => {
    const text = draft.trim();
    if (!text || isStreaming) return;
    setDraft("");
    void send(threadId, text);
  };

  return (
    <Flex
      direction="column"
      className="h-full shrink-0 border-gray-6 border-l bg-gray-2"
      style={{ width: 360, minWidth: 360 }}
    >
      <Box className="shrink-0 border-gray-6 border-b px-3 py-2">
        <Text size="2" weight="bold" className="text-gray-12">
          Build with data
        </Text>
      </Box>

      <ScrollArea ref={threadRef} className="flex-1">
        <Flex direction="column" gap="3" p="3">
          {messages.length === 0 && (
            <Flex direction="column" gap="3">
              <Text size="1" className="text-gray-10">
                Describe the canvas or app you want. The agent queries your
                PostHog project and builds it live on the canvas.
              </Text>
              {suggestions.length > 0 && draft.trim().length === 0 && (
                <Flex direction="column" align="start" gap="1">
                  {suggestions.map((suggestion) => (
                    <Button
                      key={suggestion.label}
                      variant="outline"
                      size="sm"
                      className="max-w-full justify-start text-left"
                      onClick={() => fillSuggestion(suggestion.prompt)}
                    >
                      {suggestion.label}
                    </Button>
                  ))}
                </Flex>
              )}
            </Flex>
          )}
          {messages.map((message) => (
            <Flex
              key={message.id}
              direction="column"
              className={
                message.role === "user"
                  ? "self-end rounded-lg bg-accent-4 px-3 py-2"
                  : "self-start"
              }
              style={{ maxWidth: "90%" }}
            >
              {message.text ? (
                <Text
                  size="1"
                  className={
                    message.role === "user" ? "text-accent-12" : "text-gray-11"
                  }
                  style={{ whiteSpace: "pre-wrap" }}
                >
                  {message.text}
                </Text>
              ) : (
                message.role === "assistant" &&
                isStreaming && (
                  <Text size="1" className="text-gray-9">
                    Thinking…
                  </Text>
                )
              )}
            </Flex>
          ))}
          {lastTool && (
            <Flex align="center" gap="1" className="text-gray-9">
              <SpinnerGapIcon size={12} className="animate-spin" />
              <Text size="1">{lastTool}</Text>
            </Flex>
          )}
          {error && (
            <Text size="1" className="text-red-11">
              {error}
            </Text>
          )}
        </Flex>
      </ScrollArea>

      <Box className="shrink-0 border-gray-6 border-t p-2">
        <Flex gap="2" align="end">
          <TextArea
            ref={inputRef}
            className="flex-1"
            placeholder="Build a canvas of…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={2}
          />
          <Button
            size="icon"
            variant="primary"
            aria-label="Send"
            disabled={isStreaming || draft.trim().length === 0}
            onClick={submit}
          >
            {isStreaming ? (
              <SpinnerGapIcon size={16} className="animate-spin" />
            ) : (
              <PaperPlaneRightIcon size={16} />
            )}
          </Button>
        </Flex>
      </Box>
    </Flex>
  );
}
