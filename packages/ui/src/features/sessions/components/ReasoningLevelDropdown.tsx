import { Brain, CaretDown, Question } from "@phosphor-icons/react";
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
import { Badge } from "@posthog/ui/primitives/Badge";
import { openUrlInBrowser } from "@posthog/ui/utils/browser";
import { Fragment, useRef, useState } from "react";

export interface ReasoningLevelOption {
  value: string;
  label: string;
  isDefault?: boolean;
  docsUrl?: string;
}

export interface ReasoningMenuSection {
  key: string;
  label: string;
  value: string;
  options: ReasoningLevelOption[];
  onChange: (value: string) => void;
}

interface ReasoningLevelDropdownProps {
  value: string;
  options: ReasoningLevelOption[];
  onChange?: (value: string) => void;
  sections?: ReasoningMenuSection[];
  disabled?: boolean;
}

/**
 * The one reasoning dropdown. Every surface that offers reasoning levels
 * (channel composer, new task, task page, session views) renders this. Extra
 * session settings (context window, fast mode) render as menu sections below.
 */
export function ReasoningLevelDropdown({
  value,
  options,
  onChange,
  sections,
  disabled,
}: ReasoningLevelDropdownProps) {
  const [open, setOpen] = useState(false);
  const pendingChangeRef = useRef<(() => void) | null>(null);

  if (options.length === 0) return null;

  const activeLabel =
    options.find((option) => option.value === value)?.label ?? value;

  const selectAndClose = (apply: () => void) => {
    pendingChangeRef.current = apply;
    setOpen(false);
  };

  return (
    <DropdownMenu
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(isOpen) => {
        if (!isOpen && pendingChangeRef.current !== null) {
          pendingChangeRef.current();
          pendingChangeRef.current = null;
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
          onValueChange={(next) => selectAndClose(() => onChange?.(next))}
        >
          {options.map((option) => (
            <LevelItem key={option.value} option={option} />
          ))}
        </DropdownMenuRadioGroup>
        {sections?.map((section) => (
          <Fragment key={section.key}>
            <DropdownMenuSeparator />
            <MenuLabel>{section.label}</MenuLabel>
            <DropdownMenuRadioGroup
              value={section.value}
              onValueChange={(next) =>
                selectAndClose(() => section.onChange(next))
              }
            >
              {section.options.map((option) => (
                <LevelItem key={option.value} option={option} />
              ))}
            </DropdownMenuRadioGroup>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LevelItem({ option }: { option: ReasoningLevelOption }) {
  return (
    <DropdownMenuRadioItem value={option.value}>
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
