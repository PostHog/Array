import {
  ConversationView,
  type ConversationViewProps,
} from "@posthog/ui/features/sessions/components/ConversationView";
import { ChatThread } from "@posthog/ui/features/sessions/components/chat-thread/ChatThread";
import { useSettingsStore } from "@posthog/ui/features/settings/settingsStore";

/**
 * Picks the conversation renderer at the mount boundary: the experimental ChatX thread when
 * `useNewChatThread` is on, otherwise the production `ConversationView`. Switching at the parent
 * (rather than early-returning inside `ConversationView`) keeps both components' hook order stable
 * across toggles. Flip it in Settings → Experimental.
 */
export function ThreadView(props: ConversationViewProps) {
  const useNewChatThread = useSettingsStore((s) => s.useNewChatThread);
  return useNewChatThread ? (
    <ChatThread {...props} />
  ) : (
    <ConversationView {...props} />
  );
}
