import { Brain, CaretDown, Question } from "@phosphor-icons/react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  MenuLabel,
} from "@posthog/quill";
import { Badge } from "@posthog/ui/primitives/Badge";
import { openUrlInBrowser } from "@posthog/ui/utils/browser";
import { useRef, useState } from "react";

export interface ReasoningLevelOption {
  value: string;
  label: string;
  isDefault?: boolean;
  docsUrl?: string;
}

interface ReasoningLevelDropdownProps {
  value: string;
  options: ReasoningLevelOption[];
  onChange?: (value: string) => void;
  disabled?: boolean;
}

/**
 * The one reasoning dropdown. Every surface that offers reasoning levels
 * (channel composer, new task, task page, session views) renders this.
 */
export function ReasoningLevelDropdown({
  value,
  options,
  onChange,
  disabled,
}: ReasoningLevelDropdownProps) {
  const [open, setOpen] = useState(false);
  const pendingValueRef = useRef<string | null>(null);

  if (options.length === 0) return null;

  const activeLabel =
    options.find((option) => option.value === value)?.label ?? value;

  return (
    <DropdownMenu
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(isOpen) => {
        if (!isOpen && pendingValueRef.current !== null) {
          onChange?.(pendingValueRef.current);
          pendingValueRef.current = null;
        }
      }}
    >
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="default"
            size="sm"
            disabled={disabled}
            aria-label={`Reasoning: ${activeLabel}`}
          >
            <Brain size={14} className="text-muted-foreground" />
            {activeLabel}
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
        className="min-w-[200px]"
      >
        <MenuLabel>Reasoning</MenuLabel>
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            pendingValueRef.current = next;
            setOpen(false);
          }}
        >
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              <span className="whitespace-nowrap">{option.label}</span>
              {(option.isDefault || option.docsUrl) && (
                <span className="ml-auto flex items-center gap-1.5 pl-3">
                  {option.isDefault && <Badge color="gray">Default</Badge>}
                  {option.docsUrl && (
                    <DocsLink label={option.label} docsUrl={option.docsUrl} />
                  )}
                </span>
              )}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DocsLink({ label, docsUrl }: { label: string; docsUrl: string }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={`Learn more about ${label}`}
      className="text-muted-foreground hover:text-foreground"
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void openUrlInBrowser(docsUrl);
      }}
    >
      <Question size={14} />
    </button>
  );
}
