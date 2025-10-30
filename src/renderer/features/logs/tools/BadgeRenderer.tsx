import { Badge } from "@radix-ui/themes";
import type { ComponentProps, ReactNode } from "react";

export interface BadgeConfig {
  condition: boolean | string | number | unknown;
  label: ReactNode;
  color?: ComponentProps<typeof Badge>["color"];
}

interface BadgeRendererProps {
  badges: BadgeConfig[];
}

export function BadgeRenderer({ badges }: BadgeRendererProps) {
  const visibleBadges = badges.filter((b) => Boolean(b.condition));

  if (visibleBadges.length === 0) {
    return null;
  }

  return (
    <>
      {visibleBadges.map((badge) => (
        <Badge
          key={
            typeof badge.label === "string" ? badge.label : String(badge.label)
          }
          size="1"
          color={badge.color || "gray"}
        >
          {badge.label}
        </Badge>
      ))}
    </>
  );
}
