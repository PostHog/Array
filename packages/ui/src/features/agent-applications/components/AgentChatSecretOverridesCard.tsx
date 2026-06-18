import { KeyIcon, PencilSimpleIcon, XIcon } from "@phosphor-icons/react";
import { Button } from "@posthog/ui/primitives/Button";
import { Flex, Text } from "@radix-ui/themes";
import { useState } from "react";

/**
 * Inline card surfaced above the composer on a draft preview when the draft's
 * spec declares secrets that aren't set on the agent's live env-keys. Lets the
 * author provide *per-preview* values that ride on the next mint's
 * `secret_overrides` claim — never persisted to live, never written to the
 * env-keys API. Token re-mints reuse the same values automatically since they
 * live in the parent's state (passed back via `onSave`).
 *
 * Two modes: edit (inputs) and saved (compact "edit" pill). The card hides
 * itself entirely when the author dismisses via `onDismiss` — the parent
 * decides whether to remember the dismissal across resumes.
 */
export function AgentChatSecretOverridesCard({
  missingSecrets,
  overrides,
  onSave,
  onDismiss,
}: {
  /** Names of secrets the draft declares but the live agent doesn't have set. */
  missingSecrets: string[];
  /** Current overrides held by the parent — the source of truth. */
  overrides: Record<string, string>;
  /** Replace the parent's override map with the typed values. */
  onSave: (overrides: Record<string, string>) => void;
  /** Hide the card; parent decides what "dismiss" means in their session. */
  onDismiss: () => void;
}) {
  // Pre-fill from whatever the parent already has; only the missing keys are
  // editable here (the card is the only surface that introduces overrides).
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(missingSecrets.map((k) => [k, overrides[k] ?? ""])),
  );
  const allSaved = missingSecrets.every((k) => (overrides[k] ?? "") !== "");
  const [editing, setEditing] = useState(!allSaved);

  if (!editing && allSaved) {
    return (
      <Flex
        align="center"
        gap="2"
        className="shrink-0 border-(--amber-6) border-t bg-(--amber-2) px-4 py-2"
      >
        <KeyIcon size={13} className="shrink-0 text-(--amber-11)" />
        <Text className="text-[11.5px] text-gray-11 leading-snug">
          Overriding {missingSecrets.length}{" "}
          {missingSecrets.length === 1 ? "secret" : "secrets"} for this preview
          ({missingSecrets.join(", ")}).
        </Text>
        <Button
          size="1"
          variant="ghost"
          color="gray"
          className="ml-auto"
          onClick={() => setEditing(true)}
        >
          <PencilSimpleIcon size={12} />
          Edit
        </Button>
      </Flex>
    );
  }

  const canSave = missingSecrets.every((k) => (draft[k] ?? "") !== "");

  return (
    <div className="shrink-0 border-(--amber-6) border-t bg-(--amber-2) px-4 pt-3 pb-2">
      <Flex align="start" justify="between" gap="3" className="mb-2">
        <Flex direction="column" gap="0" className="min-w-0">
          <Flex align="center" gap="2">
            <KeyIcon size={13} className="shrink-0 text-(--amber-11)" />
            <Text className="font-semibold text-[12.5px] text-gray-12">
              Provide values for this preview
            </Text>
          </Flex>
          <Text className="text-[11.5px] text-gray-11 leading-snug">
            This draft references{" "}
            {missingSecrets.length === 1 ? "a secret" : "secrets"} that aren't
            set on the live agent. Values entered here ride on the preview token
            only — never written to live.
          </Text>
        </Flex>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="shrink-0 rounded p-0.5 text-gray-10 hover:text-gray-12"
        >
          <XIcon size={13} />
        </button>
      </Flex>
      <Flex direction="column" gap="2" className="mb-2">
        {missingSecrets.map((name) => (
          <Flex key={name} align="center" gap="2">
            <Text
              className="w-44 shrink-0 truncate text-[11.5px] text-gray-12 [font-family:var(--font-mono)]"
              title={name}
            >
              {name}
            </Text>
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={draft[name] ?? ""}
              onChange={(e) =>
                setDraft((d) => ({ ...d, [name]: e.target.value }))
              }
              placeholder="paste a value for this preview"
              className="min-w-0 flex-1 rounded-(--radius-2) border border-(--amber-7) bg-(--color-panel-solid) px-2 py-1 text-[12px] text-gray-12 placeholder:text-gray-9 focus:border-(--amber-9) focus:outline-none"
            />
          </Flex>
        ))}
      </Flex>
      <Flex gap="2" justify="end">
        {allSaved ? (
          <Button
            size="1"
            variant="soft"
            color="gray"
            onClick={() => setEditing(false)}
          >
            Cancel
          </Button>
        ) : null}
        <Button
          size="1"
          variant="solid"
          color="amber"
          disabled={!canSave}
          onClick={() => {
            // Drop empty values so the request body only carries real overrides.
            const clean: Record<string, string> = {};
            for (const [k, v] of Object.entries(draft)) {
              if (v !== "") clean[k] = v;
            }
            onSave(clean);
            setEditing(false);
          }}
        >
          Save for this preview
        </Button>
      </Flex>
    </div>
  );
}
