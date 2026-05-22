import type { IconProps } from "@phosphor-icons/react";
import {
  BrainIcon,
  BugIcon,
  GithubLogoIcon,
  KanbanIcon,
  LifebuoyIcon,
  TicketIcon,
  VideoIcon,
} from "@phosphor-icons/react";
import type { ComponentType } from "react";
import { PgAnalyzeIcon } from "./PgAnalyzeIcon";

/**
 * Shared source product metadata used across inbox components.
 * Consumers render the icon component at whatever size they need.
 */
export const SOURCE_PRODUCT_META: Record<
  string,
  { Icon: ComponentType<IconProps>; color: string; label: string }
> = {
  session_replay: {
    Icon: VideoIcon,
    color: "var(--amber-9)",
    label: "Session replay",
  },
  error_tracking: {
    Icon: BugIcon,
    color: "var(--red-9)",
    label: "Error tracking",
  },
  llm_analytics: {
    Icon: BrainIcon,
    color: "var(--purple-9)",
    label: "LLM analytics",
  },
  github: {
    Icon: GithubLogoIcon,
    color: "var(--gray-11)",
    label: "GitHub",
  },
  linear: {
    Icon: KanbanIcon,
    color: "var(--blue-9)",
    label: "Linear",
  },
  zendesk: {
    Icon: TicketIcon,
    color: "var(--green-9)",
    label: "Zendesk",
  },
  conversations: {
    Icon: LifebuoyIcon,
    color: "var(--cyan-9)",
    label: "Conversations",
  },
  pganalyze: {
    Icon: PgAnalyzeIcon,
    color: "var(--gray-12)",
    label: "pganalyze",
  },
};
