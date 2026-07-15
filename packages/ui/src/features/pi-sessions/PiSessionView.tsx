import { useHostTRPC, useHostTRPCClient } from "@posthog/host-router/react";
import {
  Button,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@posthog/quill";
import { useQuery } from "@tanstack/react-query";
import { useSubscription } from "@trpc/tanstack-react-query";
import { useEffect, useMemo, useState } from "react";
import {
  applyPiEvent,
  emptyLiveFeed,
  type PiEntries,
  PiEntriesSyncer,
  type PiEvent,
  type PiLiveFeed,
  type PiMessage,
} from "./piSessionFeed";
import { useEnsurePiSession } from "./useEnsurePiSession";

interface PiSessionViewProps {
  taskId: string;
}

type PiMessageWithContent = Extract<PiMessage, { content: unknown }>;

function PiMessageView({ message }: { message: PiMessage }) {
  if (message.role === "bashExecution") {
    return <>{message.output}</>;
  }
  if (
    message.role === "branchSummary" ||
    message.role === "compactionSummary"
  ) {
    return <>{message.summary}</>;
  }
  if ("content" in message) {
    return <>{messageContentText(message)}</>;
  }
  return null;
}

function messageContentText(message: PiMessageWithContent): string {
  if (typeof message.content === "string") {
    return message.content;
  }

  return message.content
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n");
}

function messageBubbleClass(role: string): string {
  if (role === "user") {
    return "mb-3 ml-auto max-w-[80%] rounded-lg bg-accent-3 p-3 text-sm";
  }
  return "mb-3 max-w-[80%] whitespace-pre-wrap rounded-lg bg-gray-3 p-3 text-sm";
}

export function PiSessionView({ taskId }: PiSessionViewProps) {
  const trpc = useHostTRPC();
  const client = useHostTRPCClient();
  const { error: ensureError, isSuccess: sessionReady } =
    useEnsurePiSession(taskId);

  const [prompt, setPrompt] = useState("");
  const [liveFeed, setLiveFeed] = useState<PiLiveFeed>(emptyLiveFeed);
  const [syncedEntries, setSyncedEntries] = useState<PiEntries | undefined>(
    undefined,
  );

  const { data: fetchedEntries } = useQuery({
    ...trpc.piSession.entries.queryOptions({ taskId }),
    enabled: sessionReady,
  });
  const { error: statusError } = useQuery({
    ...trpc.piSession.status.queryOptions({ taskId }),
    enabled: sessionReady,
  });

  const syncer = useMemo(
    () =>
      new PiEntriesSyncer(
        (since) => client.piSession.entries.query({ taskId, since }),
        setSyncedEntries,
      ),
    [client, taskId],
  );

  useEffect(() => {
    syncer.seed(fetchedEntries);
  }, [syncer, fetchedEntries]);

  const history = syncedEntries ?? fetchedEntries;

  useSubscription(
    trpc.piSession.onEvent.subscriptionOptions(
      { taskId },
      {
        enabled: sessionReady,
        onData: (event: PiEvent) => {
          setLiveFeed((feed) => applyPiEvent(feed, event));

          if (event.type === "agent_settled") {
            void syncer.sync().then(() => setLiveFeed(emptyLiveFeed));
          }
        },
      },
    ),
  );

  const send = async () => {
    const text = prompt.trim();
    if (!text) {
      return;
    }
    await client.piSession.prompt.mutate({ taskId, prompt: text });
    setPrompt("");
  };

  const sessionError = ensureError ?? statusError;
  if (sessionError) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyTitle>Pi session failed to start</EmptyTitle>
          <EmptyDescription>{sessionError.message}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  if (!sessionReady) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyTitle>Starting Pi session…</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {history?.entries.map((entry) => {
          if (entry.type !== "message") {
            return null;
          }

          return (
            <div
              key={entry.id}
              className={messageBubbleClass(entry.message.role)}
            >
              <PiMessageView message={entry.message} />
            </div>
          );
        })}
        {liveFeed.liveMessages.map((message) => (
          <div
            key={`${message.role}-${message.timestamp}`}
            className={messageBubbleClass(message.role)}
          >
            <PiMessageView message={message} />
          </div>
        ))}
        {liveFeed.streamingMessage ? (
          <div className={messageBubbleClass("assistant")}>
            <PiMessageView message={liveFeed.streamingMessage} />
          </div>
        ) : null}
      </div>
      <div className="flex gap-2 border-gray-6 border-t p-3">
        <textarea
          aria-label="Message Pi"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void send();
            }
          }}
          placeholder="Message Pi"
          className="min-h-20 flex-1 resize-none rounded-md border border-gray-6 bg-transparent p-2 text-sm"
        />
        <Button onClick={() => void send()} disabled={!prompt.trim()}>
          Send
        </Button>
      </div>
    </div>
  );
}
