import {
  CalendarBlank,
  ChartLineUp,
  ChatsTeardrop,
  PresentationChart,
  Trophy,
} from "@phosphor-icons/react";
import type { ComponentType } from "react";

interface IconProps {
  size?: number | string;
  weight?: "thin" | "light" | "regular" | "bold" | "fill" | "duotone";
  className?: string;
}

export interface ExamplePrompt {
  id: string;
  name: string;
  description: string;
  prompt: string;
  icon: ComponentType<IconProps>;
}

/**
 * Curated starter prompts shown in the Generate view. Each entry is the kind of
 * recurring job a non-engineer would actually want an agent to do. Clicking one
 * prefills the generator.
 */
export const EXAMPLE_PROMPTS: ExamplePrompt[] = [
  {
    id: "competitive-analysis",
    name: "Weekly competitive analysis",
    description: "Track what competitors shipped and talked about",
    prompt:
      "Each Monday morning, scan our top competitors' marketing pages, blog posts, changelogs, and recent social posts. Summarise what they shipped, what they're emphasising, and any pricing or positioning changes. Flag anything worth a deeper look.",
    icon: Trophy,
  },
  {
    id: "daily-briefing",
    name: "Daily meeting briefing",
    description: "Prep notes for the day's calendar based on context",
    prompt:
      "Every weekday morning at 8am, look at my calendar for the day. For each meeting, pull together a short briefing: who's attending, what we discussed last time, any decisions still outstanding, and one or two suggested talking points.",
    icon: CalendarBlank,
  },
  {
    id: "customer-feedback-digest",
    name: "Customer feedback digest",
    description: "Weekly themes from support, interviews, and surveys",
    prompt:
      "Each Monday, gather customer feedback from support tickets, interview notes, and surveys over the past week. Cluster into the top 3 themes worth raising in our product meeting, with quotes and frequency.",
    icon: ChatsTeardrop,
  },
  {
    id: "monthly-metric-review",
    name: "Monthly metric review",
    description: "Narrative summary of your key product metrics",
    prompt:
      "On the 1st of each month, compile our key product metrics (DAU/WAU, retention, top-feature engagement, conversion) versus the previous month. Write a short narrative summary of what changed, what's working, and what looks worrying.",
    icon: PresentationChart,
  },
  {
    id: "weekly-product-update",
    name: "Weekly product update",
    description: "Drafted update for your team's Monday standup",
    prompt:
      "Every Monday at 9am, draft a weekly product update for my team: top events shipped, the biggest metric changes from last week, and anything anomalous worth flagging. Format it for sharing in Slack.",
    icon: ChartLineUp,
  },
];
