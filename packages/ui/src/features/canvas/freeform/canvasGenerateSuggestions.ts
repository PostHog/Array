import {
  ArrowsClockwise,
  BellRinging,
  ChartLine,
  CurrencyDollar,
  EnvelopeSimple,
  FunnelSimple,
  Lightning,
  UsersThree,
} from "@phosphor-icons/react";
import type { SuggestedPrompt } from "@posthog/ui/features/task-detail/components/SuggestedPromptCard";

// Starter prompts shown below the centered composer on an empty freeform
// canvas. Clicking a card drops its `prompt` into the composer, ready to
// edit/send. No `mode` — the unified generation prompt decides whether a
// request is a plain canvas or a workflow build, so workflow ideas are just
// prompts like the rest.
export const CANVAS_GENERATE_SUGGESTIONS: SuggestedPrompt[] = [
  {
    label: "Weekly active users",
    description: "Active users over time, with the trend called out",
    icon: ChartLine,
    color: "blue",
    prompt:
      "Build a dashboard showing weekly active users over the last 90 days, with the overall trend and any notable changes called out.",
  },
  {
    label: "Signup → activation funnel",
    description: "Conversion at each step from signup to activation",
    icon: FunnelSimple,
    color: "violet",
    prompt:
      "Build a funnel from signup to activation, showing the conversion rate at each step and where the biggest drop-off happens.",
  },
  {
    label: "Revenue by plan",
    description: "Revenue trends over time, broken down by plan",
    icon: CurrencyDollar,
    color: "green",
    prompt:
      "Build a canvas showing revenue trends over time broken down by plan, calling out the fastest-growing and shrinking segments.",
  },
  {
    label: "Slack alert on an event",
    description: "Post to Slack whenever a chosen event fires",
    icon: BellRinging,
    color: "amber",
    prompt:
      "Build a workflow that posts a Slack message whenever a specific event fires, including the key event properties in the message.\n\nEvent to watch: \nSlack channel: ",
  },
  {
    label: "Welcome email after signup",
    description: "Send new signups a welcome email sequence",
    icon: EnvelopeSimple,
    color: "blue",
    prompt:
      "Build a workflow that sends a welcome email to new signups, with a follow-up a few days later if they haven't come back.",
  },
  {
    label: "Track an existing workflow",
    description: "A metrics board for a workflow you already have",
    icon: Lightning,
    color: "violet",
    prompt:
      "Build a metrics dashboard tracking my existing workflow. Find it and link this canvas to it - don't create a new one.\n\nWorkflow name: ",
  },
  {
    label: "Retention cohorts",
    description: "How well users stick around week over week",
    icon: ArrowsClockwise,
    color: "purple",
    prompt:
      "Build a retention cohort view showing how well new users stick around week over week, and highlight which cohorts retain best.",
  },
  {
    label: "Feature adoption",
    description: "Adoption and engagement of a specific feature",
    icon: UsersThree,
    color: "teal",
    prompt:
      "Build a canvas analyzing how a specific feature is being adopted — usage over time, share of active users, and engagement.\n\nFeature to analyze: ",
  },
];
