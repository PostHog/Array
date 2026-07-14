import { validateChannelName } from "@posthog/core/canvas/channelName";
import {
  Button,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldError,
  FieldLabel,
  Input,
  Switch,
  Textarea,
} from "@posthog/quill";
import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import { useChannelMutations } from "@posthog/ui/features/canvas/hooks/useChannels";
import { useGenerateContext } from "@posthog/ui/features/canvas/hooks/useGenerateContext";
import { toast } from "@posthog/ui/primitives/toast";
import { track } from "@posthog/ui/shell/analytics";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

// Matches Slack's "Create a channel" naming constraint.
const MAX_CONTEXT_NAME_LENGTH = 80;

const DESCRIPTION_PLACEHOLDER =
  "Grab all files relating to X feature, get all relevant pull requests, in this X repo(s)";

interface CreateChannelModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // When set, the dialog is the "Create your CONTEXT.md" flow for an existing
  // context: no name field, just a description that seeds the planning session.
  existingContext?: { channelId: string; channelName: string };
}

// Two dialogs in one, split on `existingContext`:
// - Create mode: names the context, creates it, and lands the user in its feed
//   (the intro card there carries onboarding). An off-by-default toggle reveals
//   the description textarea to also launch the context.md plan session at
//   creation time.
// - Describe mode: the "Create your context.md" dialog (opened from the intro
//   card or the CONTEXT.md empty state). A single textarea whose text seeds
//   a plan-mode session that builds the context's CONTEXT.md with the user.
export function CreateChannelModal({
  open,
  onOpenChange,
  existingContext,
}: CreateChannelModalProps) {
  const isDescribeMode = !!existingContext;
  const { createChannel, isCreating } = useChannelMutations();
  const { generate, isStarting } = useGenerateContext();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  // Create mode's opt-in "also plan the context.md now" toggle.
  const [withContextMd, setWithContextMd] = useState(false);

  // Reset the fields each time the modal opens so a previous draft never
  // lingers. Adjusted inline during render (prev-prop comparison) rather than in
  // an effect, which would flash a stale value for one commit.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setName("");
      setDescription("");
      setWithContextMd(false);
    }
  }

  const trimmedName = name.trim();
  const trimmedDescription = description.trim();
  const remaining = MAX_CONTEXT_NAME_LENGTH - name.length;
  const nameError = isDescribeMode ? null : validateChannelName(trimmedName);

  // The description textarea is live in describe mode and in create mode once
  // the toggle is on; either way it must be filled to submit.
  const needsDescription = isDescribeMode || withContextMd;
  const busy = isCreating || isStarting;
  const canSubmit =
    !busy &&
    (isDescribeMode ? true : !!trimmedName && !nameError) &&
    (!needsDescription || !!trimmedDescription);

  // Create mode: create the context, then land in the channel — its feed opens
  // with the intro (name, creation line, context.md card) and the "joined" row,
  // both derived from the channel row. With the toggle on, also launch the
  // plan session that builds context.md, seeded by the description.
  const submitCreate = async () => {
    let contextId: string;
    try {
      const channel = await createChannel(trimmedName);
      track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
        action_type: "create",
        surface: "sidebar",
        channel_id: channel.id,
        success: true,
      });
      contextId = channel.id;
    } catch (error) {
      track(ANALYTICS_EVENTS.CHANNEL_ACTION, {
        action_type: "create",
        surface: "sidebar",
        success: false,
      });
      toast.error("Couldn't create context", {
        description: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    if (withContextMd && trimmedDescription) {
      track(ANALYTICS_EVENTS.CONTEXT_ACTION, {
        action_type: "generate_started",
        channel_id: contextId,
      });
      // Failure is fine to swallow here (generate() already toasted): the
      // context exists, so land the user on it — the intro card offers the
      // retry.
      await generate({
        channelId: contextId,
        channelName: trimmedName,
        description: trimmedDescription,
      });
    }

    onOpenChange(false);
    void navigate({
      to: "/website/$channelId",
      params: { channelId: contextId },
    });
  };

  // Describe mode: launch the plan-mode session that builds CONTEXT.md. On
  // failure (generate() already toasted) the dialog stays open, state intact,
  // for a clean retry.
  const submitDescribe = async () => {
    if (!existingContext) return;
    track(ANALYTICS_EVENTS.CONTEXT_ACTION, {
      action_type: "generate_started",
      channel_id: existingContext.channelId,
    });
    const task = await generate({
      channelId: existingContext.channelId,
      channelName: existingContext.channelName,
      description: trimmedDescription,
    });
    if (!task) return;

    // Land on the context index (its feed), where the announcement and the plan
    // task card show. The user clicks the card to open the session.
    onOpenChange(false);
    void navigate({
      to: "/website/$channelId",
      params: { channelId: existingContext.channelId },
    });
  };

  const submit = async () => {
    if (!canSubmit) return;
    if (isDescribeMode) {
      await submitDescribe();
    } else {
      await submitCreate();
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
    >
      <DialogContent showCloseButton={false} className="sm:max-w-lg">
        {isDescribeMode ? (
          // No visible header in describe mode — the textarea's label carries
          // the dialog; the title stays for screen readers.
          <DialogTitle className="sr-only">Create your context.md</DialogTitle>
        ) : (
          <DialogHeader>
            <DialogTitle>Create a context</DialogTitle>
          </DialogHeader>
        )}

        <DialogBody viewportClassName="flex flex-col gap-4">
          {!isDescribeMode && (
            <>
              <Field>
                <FieldLabel htmlFor="context-name">Name</FieldLabel>
                <Input
                  id="context-name"
                  autoFocus
                  value={name}
                  placeholder="e.g. mobile"
                  maxLength={MAX_CONTEXT_NAME_LENGTH}
                  disabled={busy}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void submit();
                    }
                  }}
                />
                {nameError ? (
                  <FieldError>{nameError}</FieldError>
                ) : (
                  <span className="text-gray-9 text-xs tabular-nums">
                    {remaining} left
                  </span>
                )}
              </Field>
              <label
                htmlFor="context-with-md"
                className="flex cursor-pointer items-center gap-2 text-sm"
              >
                <Switch
                  id="context-with-md"
                  className="shrink-0"
                  checked={withContextMd}
                  disabled={busy}
                  onCheckedChange={(checked) => setWithContextMd(!!checked)}
                />
                Plan its context.md now
              </label>
            </>
          )}

          {needsDescription && (
            <Field>
              <FieldLabel htmlFor="context-description">
                What's this context about?
              </FieldLabel>
              <Textarea
                id="context-description"
                autoFocus={isDescribeMode}
                rows={4}
                value={description}
                placeholder={DESCRIPTION_PLACEHOLDER}
                disabled={busy}
                onChange={(e) => setDescription(e.target.value)}
                onKeyDown={(e) => {
                  // ⌘/Ctrl+Enter submits; a bare Enter stays a newline.
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void submit();
                  }
                }}
              />
            </Field>
          )}
        </DialogBody>

        <DialogFooter>
          <DialogClose
            render={
              <Button variant="outline" disabled={busy}>
                Cancel
              </Button>
            }
          />
          <Button
            variant="primary"
            disabled={!canSubmit}
            loading={busy}
            onClick={submit}
          >
            {needsDescription ? "Plan and create" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
