import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import { setRootContainer } from "@posthog/di/container";
import { ServiceProvider } from "@posthog/di/react";
import {
  HOST_TRPC_CLIENT,
  type HostTrpcClient,
} from "@posthog/host-router/client";
import { PromptInput } from "@posthog/ui/features/message-editor/components/PromptInput";
import type { MentionChip } from "@posthog/ui/features/message-editor/content";
import type { EditorHandle } from "@posthog/ui/features/message-editor/types";
import { ReasoningLevelSelector } from "@posthog/ui/features/sessions/components/ReasoningLevelSelector";
import { UnifiedModelSelector } from "@posthog/ui/features/sessions/components/UnifiedModelSelector";
import type { AgentAdapter } from "@posthog/ui/features/settings/settingsStore";
import { IMPERATIVE_QUERY_CLIENT } from "@posthog/ui/shell/queryClient";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Container } from "inversify";
import { type ReactNode, useEffect, useRef, useState } from "react";

// --- Host-agnostic story providers ---

const noopHostClient = {
  git: {
    getGhStatus: {
      query: async () => ({
        installed: true,
        version: "2.0.0",
        authenticated: true,
        username: "storybook",
        error: null,
      }),
    },
    searchGithubRefs: { query: async () => [] },
    getGithubPullRequest: { query: async () => null },
    getGithubIssue: { query: async () => null },
  },
  fs: {
    listRepoFiles: { query: async () => [] },
    readAbsoluteFile: { query: async () => null },
  },
  os: {
    selectDirectory: { query: async () => null },
    selectAttachments: { query: async () => [] },
    readFileAsDataUrl: { query: async () => null },
    saveClipboardImage: {
      mutate: async () => ({ path: "", name: "", mimeType: "" }),
    },
    saveClipboardText: { mutate: async () => ({ path: "", name: "" }) },
    saveClipboardFile: { mutate: async () => ({ path: "", name: "" }) },
    downscaleImageFile: { mutate: async () => ({ path: "", name: "" }) },
  },
} as unknown as HostTrpcClient;

const storyQueryClient = new QueryClient();

const storyContainer = new Container();
storyContainer
  .bind<HostTrpcClient>(HOST_TRPC_CLIENT)
  .toConstantValue(noopHostClient);
storyContainer.bind(IMPERATIVE_QUERY_CLIENT).toConstantValue(storyQueryClient);
setRootContainer(storyContainer);

function StoryProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={storyQueryClient}>
      <ServiceProvider container={storyContainer}>
        <div className="max-w-[800px]">{children}</div>
      </ServiceProvider>
    </QueryClientProvider>
  );
}

// --- Mock data matching SessionConfigOption shape ---

const mockModelOption = {
  id: "model",
  name: "Model",
  type: "select" as const,
  currentValue: "gpt-5.5",
  options: [
    {
      group: "recommended",
      name: "Recommended",
      options: [
        { value: "gpt-5.5", name: "gpt-5.5" },
        { value: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
      ],
    },
    {
      group: "other",
      name: "Other",
      options: [
        { value: "claude-opus-4-8", name: "Claude Opus 4.8" },
        { value: "o3-pro", name: "o3-pro" },
      ],
    },
  ],
} satisfies SessionConfigOption;

const mockReasoningOption = {
  id: "thought",
  name: "Reasoning",
  type: "select" as const,
  currentValue: "high",
  options: [
    { value: "off", name: "Off" },
    { value: "low", name: "Low" },
    { value: "medium", name: "Medium" },
    { value: "high", name: "High" },
  ],
} satisfies SessionConfigOption;

// --- Wrapper to inject chips after mount ---

function PromptInputWithChips({
  chips,
  ...props
}: React.ComponentProps<typeof PromptInput> & { chips?: MentionChip[] }) {
  const ref = useRef<EditorHandle>(null);
  const insertedRef = useRef(false);

  useEffect(() => {
    if (!chips?.length || insertedRef.current) return;
    insertedRef.current = true;
    const timer = setTimeout(() => {
      for (const chip of chips) {
        ref.current?.insertChip(chip);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [chips]);

  return <PromptInput ref={ref} {...props} />;
}

// --- Wrapper with stateful selectors ---

function PromptInputWithSelectors({
  chips,
  showSelectors = true,
  ...props
}: React.ComponentProps<typeof PromptInput> & {
  chips?: MentionChip[];
  showSelectors?: boolean;
}) {
  const [adapter, setAdapter] = useState<AgentAdapter>("claude");
  const [modelOption, setModelOption] =
    useState<SessionConfigOption>(mockModelOption);
  const [reasoningOption, setReasoningOption] =
    useState<SessionConfigOption>(mockReasoningOption);

  const handleModelChange = (value: string) => {
    setModelOption({ ...mockModelOption, currentValue: value });
  };

  const handleReasoningChange = (value: string) => {
    setReasoningOption({ ...mockReasoningOption, currentValue: value });
  };

  return (
    <PromptInputWithChips
      chips={chips}
      modelSelector={
        showSelectors ? (
          <UnifiedModelSelector
            modelOption={modelOption}
            adapter={adapter}
            onAdapterChange={setAdapter}
            onModelChange={handleModelChange}
          />
        ) : (
          false
        )
      }
      reasoningSelector={
        showSelectors ? (
          <ReasoningLevelSelector
            thoughtOption={reasoningOption}
            adapter={adapter}
            onChange={handleReasoningChange}
          />
        ) : (
          false
        )
      }
      {...props}
    />
  );
}

const meta: Meta<typeof PromptInputWithSelectors> = {
  title: "Features/MessageEditor/PromptInput",
  component: PromptInputWithSelectors,
  parameters: {
    layout: "padded",
  },
  decorators: [
    (Story) => (
      <StoryProviders>
        <Story />
      </StoryProviders>
    ),
  ],
  args: {
    sessionId: "storybook-session",
    placeholder: "Type a message...",
    disabled: false,
    isLoading: false,
    autoFocus: true,
    isActiveSession: true,
    enableBashMode: true,
    enableCommands: true,
    showSelectors: true,
    onSubmit: () => {},
    onCancel: () => {},
  },
  argTypes: {
    disabled: { control: "boolean" },
    isLoading: { control: "boolean" },
    enableBashMode: { control: "boolean" },
    enableCommands: { control: "boolean" },
    showSelectors: { control: "boolean" },
    placeholder: { control: "text" },
  },
};

export default meta;
type Story = StoryObj<typeof PromptInputWithSelectors>;

export const Default: Story = {};

export const WithFileChip: Story = {
  name: "With File Chip",
  args: {
    chips: [
      {
        type: "file",
        id: "/src/settings.json",
        label: ".claude/settings.json",
      },
    ],
  },
};

export const WithCommandChip: Story = {
  name: "With Command Chip",
  args: {
    chips: [{ type: "command", id: "good", label: "good" }],
  },
};

export const WithMultipleChips: Story = {
  name: "With Multiple Chips",
  args: {
    chips: [
      {
        type: "file",
        id: "/src/settings.json",
        label: ".claude/settings.json",
      },
      { type: "command", id: "good", label: "good" },
      {
        type: "file",
        id: "/workflows/release.yml",
        label: "workflows/agent-release.yml",
      },
    ],
  },
};

export const AllChipTypes: Story = {
  name: "All Chip Types",
  args: {
    chips: [
      { type: "file", id: "/src/index.ts", label: "src/index.ts" },
      { type: "command", id: "review", label: "review" },
      {
        type: "github_issue",
        id: "https://github.com/org/repo/issues/123",
        label: "#123 Fix the bug",
      },
      { type: "error", id: "error-1", label: "TypeError: undefined" },
      { type: "experiment", id: "exp-1", label: "new-checkout-flow" },
      { type: "insight", id: "insight-1", label: "Weekly active users" },
      { type: "feature_flag", id: "flag-1", label: "enable-dark-mode" },
      {
        type: "file",
        id: "/tmp/pasted-content.txt",
        label: "pasted-content.txt",
      },
    ],
  },
};

export const BashMode: Story = {
  name: "Bash Mode (type ! to activate)",
  args: {
    enableBashMode: true,
    placeholder: "Type ! to enter bash mode...",
  },
};

export const Loading: Story = {
  name: "Loading (With Cancel)",
  args: {
    isLoading: true,
  },
};

export const Disabled: Story = {
  args: {
    disabled: true,
  },
};

export const LongChipLabels: Story = {
  name: "Long Chip Labels",
  args: {
    chips: [
      {
        type: "file",
        id: "/apps/code/src/renderer/features/message-editor/tiptap/MentionChipView.tsx",
        label:
          "apps/code/src/renderer/features/message-editor/tiptap/MentionChipView.tsx",
      },
      {
        type: "file",
        id: "/packages/agent/src/adapters/claude/permissions/permission-options.ts",
        label:
          "packages/agent/src/adapters/claude/permissions/permission-options.ts",
      },
    ],
  },
};

export const NoToolbar: Story = {
  name: "No Toolbar (Minimal)",
  args: {
    showSelectors: false,
  },
};
