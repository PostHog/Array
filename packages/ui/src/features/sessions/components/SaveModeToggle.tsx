import { CaretDown, Info, Leaf } from "@phosphor-icons/react";
import type { SaveMode } from "@posthog/core/save-mode/saveMode";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  MenuLabel,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@posthog/quill";
import { ANALYTICS_EVENTS } from "@posthog/shared";
import { useSettingsStore } from "@posthog/ui/features/settings/settingsStore";
import { track } from "@posthog/ui/shell/analytics";
import { useApplySaveMode } from "../hooks/useApplySaveMode";

const TRIGGER_LABEL: Record<SaveMode, string> = {
  off: "Off",
  balanced: "Balanced",
  max_save: "Max savings",
};

const SAVE_MODE_VS_EFFORT = (
  <>
    <strong>Effort</strong> controls thinking depth. <strong>Save Mode</strong>{" "}
    cuts cost: <strong>Balanced</strong> caps effort and shortens replies;{" "}
    <strong>Max savings</strong> also switches to a cheaper model.
  </>
);

export function SaveModeToggle({
  taskId,
  disabled,
}: {
  taskId?: string;
  disabled?: boolean;
}) {
  const saveMode = useSettingsStore((s) => s.saveMode);
  const setSaveMode = useSettingsStore((s) => s.setSaveMode);
  const applyToSession = useApplySaveMode(taskId);
  const active = saveMode !== "off";

  const handleChange = (value: string) => {
    const nextMode = value as SaveMode;
    const prevMode = saveMode;
    setSaveMode(nextMode);
    applyToSession(nextMode);
    track(ANALYTICS_EVENTS.SAVE_MODE_CHANGED, {
      new_mode: nextMode,
      old_mode: prevMode,
      context: taskId ? "session" : "new-task",
      task_id: taskId,
    });
  };

  return (
    <div className="flex items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="default"
              size="sm"
              disabled={disabled}
              aria-label="Save Mode"
            >
              <Leaf size={14} className="text-muted-foreground" />
              <span
                className={active ? "font-medium" : "text-muted-foreground"}
              >
                {TRIGGER_LABEL[saveMode]}
              </span>
              <CaretDown
                size={10}
                weight="bold"
                className="text-muted-foreground"
              />
            </Button>
          }
        />
        <DropdownMenuContent
          align="end"
          side="top"
          sideOffset={6}
          className="w-auto min-w-[220px]"
        >
          <MenuLabel>Save Mode</MenuLabel>
          <DropdownMenuRadioGroup value={saveMode} onValueChange={handleChange}>
            <DropdownMenuRadioItem value="off">Off</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="balanced">
              Balanced
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="max_save">
              Maximum savings
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <TooltipProvider delay={600}>
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                role="img"
                className="inline-flex cursor-help text-muted-foreground"
                aria-label="How Save Mode differs from Effort"
              >
                <Info size={14} />
              </span>
            }
          />
          <TooltipContent side="top" className="max-w-[280px]">
            {SAVE_MODE_VS_EFFORT}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}
