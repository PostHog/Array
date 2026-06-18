import { ActionSelector } from "@posthog/ui/primitives/ActionSelector";
import { type BasePermissionProps, toSelectorOptions } from "./types";

export function SwitchModePermission({
  options,
  onSelect,
  onCancel,
}: BasePermissionProps) {
  return (
    <ActionSelector
      title="Implementation Plan"
      question="Approve this plan to proceed?"
      options={toSelectorOptions(options)}
      onSelect={onSelect}
      onCancel={onCancel}
    />
  );
}
