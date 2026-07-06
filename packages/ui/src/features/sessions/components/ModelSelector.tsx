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
import { GLM_MODEL_FLAG } from "@posthog/shared";
import { useFeatureFlag } from "@posthog/ui/features/feature-flags/useFeatureFlag";
import { stripGlmModelOption } from "@posthog/ui/features/sessions/modelOptionFilters";
import {
  flattenSelectOptions,
  useModelConfigOptionForTask,
  useSessionIsCloud,
  useSessionSelector,
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
  // Narrow reads instead of the whole session, so the model dropdown doesn't
  // re-render on every streamed token during a turn.
  const sessionStatus = useSessionSelector(taskId, (s) => s?.status);
  const sessionIsCloud = useSessionIsCloud(taskId);
  const rawModelOption = useModelConfigOptionForTask(taskId);
  const glmEnabled = useFeatureFlag(GLM_MODEL_FLAG);
  const modelOption =
    glmEnabled || !rawModelOption
      ? rawModelOption
      : stripGlmModelOption(rawModelOption);

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

    if (!taskId) return;
    if (sessionStatus !== "connected" && !sessionIsCloud) return;
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
