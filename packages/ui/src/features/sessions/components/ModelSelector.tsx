import type { SessionConfigSelectGroup } from "@agentclientprotocol/sdk";
import { CaretDown } from "@phosphor-icons/react";
import type { SessionService } from "@posthog/core/sessions/sessionService";
import { SESSION_SERVICE } from "@posthog/core/sessions/sessionService";
import { useService } from "@posthog/di/react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  MenuLabel,
} from "@posthog/quill";
import {
  flattenSelectOptions,
  useModelConfigOptionForTask,
  useSessionForTask,
} from "@posthog/ui/features/sessions/sessionStore";
import { Fragment, useMemo } from "react";

interface ModelSelectorProps {
  taskId?: string;
  disabled?: boolean;
  onModelChange?: (modelId: string) => void;
  adapter?: "claude" | "codex";
}

export function ModelSelector({
  taskId,
  disabled,
  onModelChange,
}: ModelSelectorProps) {
  const sessionService = useService<SessionService>(SESSION_SERVICE);
  const session = useSessionForTask(taskId);
  const modelOption = useModelConfigOptionForTask(taskId);

  const selectOption = modelOption?.type === "select" ? modelOption : undefined;
  const options = selectOption
    ? flattenSelectOptions(selectOption.options)
    : [];
  const groupedOptions = useMemo(() => {
    if (!selectOption || selectOption.options.length === 0) return [];
    if ("group" in selectOption.options[0]) {
      return selectOption.options as SessionConfigSelectGroup[];
    }
    return [];
  }, [selectOption]);

  if (!selectOption || options.length === 0) return null;

  const handleChange = (value: string) => {
    onModelChange?.(value);

    if (!taskId || !session) return;
    if (session.status !== "connected" && !session.isCloud) return;
    sessionService.setSessionConfigOption(taskId, selectOption.id, value);
  };

  const currentValue = selectOption.currentValue;
  const currentLabel =
    options.find((opt) => opt.value === currentValue)?.name ?? currentValue;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="default"
            size="sm"
            disabled={disabled}
            aria-label="Model"
          >
            {currentLabel}
            <CaretDown
              size={10}
              weight="bold"
              className="text-muted-foreground"
            />
          </Button>
        }
      />
      <DropdownMenuContent
        align="start"
        side="top"
        sideOffset={6}
        className="min-w-[220px]"
      >
        {groupedOptions.length > 0 ? (
          <DropdownMenuRadioGroup
            value={currentValue}
            onValueChange={handleChange}
          >
            {groupedOptions.map((group, index) => (
              <Fragment key={group.group}>
                {index > 0 && <DropdownMenuSeparator />}
                <MenuLabel>{group.name}</MenuLabel>
                {group.options.map((model) => (
                  <DropdownMenuRadioItem key={model.value} value={model.value}>
                    <span className="whitespace-nowrap">{model.name}</span>
                  </DropdownMenuRadioItem>
                ))}
              </Fragment>
            ))}
          </DropdownMenuRadioGroup>
        ) : (
          <DropdownMenuRadioGroup
            value={currentValue}
            onValueChange={handleChange}
          >
            {options.map((model) => (
              <DropdownMenuRadioItem key={model.value} value={model.value}>
                <span className="whitespace-nowrap">{model.name}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
