/**
 * Minimal stand-ins for the `@posthog/lemon-ui` components used by the vendored
 * MarkdownNotebook editor, implemented on top of `@posthog/quill` primitives.
 * Only the props the vendored files actually use are supported.
 */
import {
  Button,
  cn,
  Input,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@posthog/quill";
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  JSX,
  KeyboardEvent,
  ReactElement,
  ReactNode,
  Ref,
  TextareaHTMLAttributes,
} from "react";

function withTooltip(trigger: ReactElement, tooltip: ReactNode): ReactElement {
  if (!tooltip) {
    return trigger;
  }
  return (
    <TooltipProvider delay={300}>
      <Tooltip>
        <TooltipTrigger render={trigger} />
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export interface LemonButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  icon?: ReactNode;
  sideIcon?: ReactNode;
  /** Lemon "type" is the visual variant, not the HTML button type. */
  type?: "primary" | "secondary" | "tertiary";
  status?: "danger" | "default" | "alt";
  size?: "xsmall" | "small" | "medium" | "large";
  tooltip?: ReactNode;
  active?: boolean;
  fullWidth?: boolean;
  center?: boolean;
  noPadding?: boolean;
  /** Like `disabled`, but explains why via a tooltip. */
  disabledReason?: string | null | false;
  [dataAttr: `data-${string}`]: string | number | boolean | undefined;
}

const QUILL_VARIANT_BY_LEMON_TYPE = {
  primary: "primary",
  secondary: "outline",
  tertiary: "default",
} as const;

export function LemonButton({
  icon,
  sideIcon,
  type = "tertiary",
  status,
  size = "medium",
  tooltip,
  active,
  fullWidth,
  center,
  noPadding,
  disabledReason,
  disabled,
  className,
  children,
  ...buttonProps
}: LemonButtonProps): JSX.Element {
  const isIconOnly = Boolean(icon) && children === undefined;
  const isDanger = status === "danger";
  const variant =
    isDanger && type === "primary"
      ? "destructive"
      : QUILL_VARIANT_BY_LEMON_TYPE[type];
  const quillSize =
    size === "xsmall"
      ? isIconOnly
        ? "icon-xs"
        : "xs"
      : size === "small"
        ? isIconOnly
          ? "icon-sm"
          : "sm"
        : isIconOnly
          ? "icon"
          : "default";
  const isDisabled = Boolean(disabled) || Boolean(disabledReason);

  const button = (
    <Button
      variant={variant}
      size={quillSize}
      disabled={isDisabled}
      focusableWhenDisabled={Boolean(disabledReason)}
      className={cn(
        active && "bg-(--fill-selected)",
        isDanger && variant !== "destructive" && "text-destructive",
        fullWidth && "w-full",
        center && "justify-center",
        noPadding && "p-0",
        className,
      )}
      {...buttonProps}
    >
      {icon}
      {children}
      {sideIcon}
    </Button>
  );

  return withTooltip(button, disabledReason || tooltip);
}

export interface LemonInputProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    "onChange" | "size" | "value"
  > {
  value?: string;
  onChange?: (value: string) => void;
  onPressEnter?: (event: KeyboardEvent<HTMLInputElement>) => void;
  inputRef?: Ref<HTMLInputElement>;
  size?: "xsmall" | "small" | "medium" | "large";
  [dataAttr: `data-${string}`]: string | number | boolean | undefined;
}

export function LemonInput({
  value,
  onChange,
  onPressEnter,
  onKeyDown,
  inputRef,
  size: _size,
  ...inputProps
}: LemonInputProps): JSX.Element {
  return (
    <Input
      ref={inputRef}
      value={value ?? ""}
      onChange={(event) => onChange?.(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          onPressEnter?.(event);
        }
        onKeyDown?.(event);
      }}
      {...inputProps}
    />
  );
}

export interface LemonTextAreaProps
  extends Omit<
    TextareaHTMLAttributes<HTMLTextAreaElement>,
    "onChange" | "value"
  > {
  value?: string;
  onChange?: (value: string) => void;
  minRows?: number;
  [dataAttr: `data-${string}`]: string | number | boolean | undefined;
}

export function LemonTextArea({
  value,
  onChange,
  minRows,
  rows,
  ...textAreaProps
}: LemonTextAreaProps): JSX.Element {
  return (
    <Textarea
      value={value ?? ""}
      rows={rows ?? minRows}
      onChange={(event) => onChange?.(event.target.value)}
      {...textAreaProps}
    />
  );
}
