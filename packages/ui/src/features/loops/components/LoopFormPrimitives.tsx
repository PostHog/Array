import { Flex, Text } from "@radix-ui/themes";
import type { ReactNode } from "react";

/**
 * A labelled form control: a consistent label, an optional below-field hint,
 * and a subtle marker for required fields. Shared across the loop form and its
 * sub-editors so every field reads the same.
 */
export function Field({
  label,
  hint,
  required,
  className,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Flex direction="column" gap="1" className={className}>
      <Text as="label" className="font-medium text-[12px] text-gray-11">
        {label}
        {required ? <span className="ml-0.5 text-(--accent-9)">*</span> : null}
      </Text>
      {children}
      {hint ? (
        <Text className="text-[11px] text-gray-10 leading-snug">{hint}</Text>
      ) : null}
    </Flex>
  );
}

/**
 * One section of the loop form, rendered as a titled card with a leading icon
 * so the long form reads as distinct, scannable groups rather than a flat
 * stack.
 */
export function SectionCard({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Flex
      direction="column"
      gap="4"
      className="rounded-(--radius-3) border border-border bg-(--color-panel-solid) p-4"
    >
      <Flex align="center" className="gap-2.5">
        <Flex
          align="center"
          justify="center"
          className="size-7 shrink-0 rounded-(--radius-2) bg-(--gray-3) text-gray-11"
        >
          {icon}
        </Flex>
        <Flex direction="column" className="min-w-0">
          <Text className="font-medium text-[13px] text-gray-12">{title}</Text>
          {description ? (
            <Text className="text-[12px] text-gray-10 leading-snug">
              {description}
            </Text>
          ) : null}
        </Flex>
      </Flex>
      {children}
    </Flex>
  );
}
