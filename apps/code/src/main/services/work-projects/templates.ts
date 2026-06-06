import type { NewTileInput, ProjectIconId } from "@shared/types/work-projects";

export type TemplateCategory =
  | "growth"
  | "engineering"
  | "product"
  | "ops"
  | "research";

export interface ProjectTemplate {
  id: string;
  name: string;
  tagline: string;
  iconId: ProjectIconId;
  category: TemplateCategory;
  /** One-line summary shown on the gallery card. */
  description: string;
  /** Tiles instantiated when the user picks this template. Receive
   *  fresh ids + `state: "live"` + `origin: "seed"` at create time. */
  tiles: NewTileInput[];
  /** Opening prompt fired as the first chat message after creation. */
  openingPrompt: string;
}

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: "funnel-audit",
    name: "Funnel audit",
    tagline: "Find the worst drop-offs in a 30-day window",
    iconId: "target",
    category: "growth",
    description:
      "Audit a signup-to-activation funnel, surface the leakiest steps, and propose hypotheses for each.",
    tiles: [
      {
        type: "note",
        size: "md",
        body: `# Funnel drop-off hypotheses\n\nThe agent will replace this with the actual leaks it finds and 2 concrete hypotheses for each.\n\n## Step → Step (pending)\n- Hypothesis 1: …\n- Hypothesis 2: …\n`,
        tone: "neutral",
      },
      {
        type: "note",
        size: "sm",
        body: "Are we measuring 'activation' the right way? Worth confirming the event definitions first.",
        tone: "yellow",
      },
    ],
    openingPrompt:
      "Audit our signup-to-activation funnel over the last 30 days. Use the PostHog tools to query the funnel, surface the worst drop-offs, propose two concrete hypotheses for each, and fill in the hypotheses.md file tile on the canvas.",
  },
  {
    id: "monday-brief",
    name: "Monday brief",
    tagline: "What changed in the product last week",
    iconId: "compass",
    category: "product",
    description:
      "A weekly briefing: top product events, behavior shifts, anything that looks like a regression.",
    tiles: [
      {
        type: "note",
        size: "md",
        body: `# Monday brief\n\n**Week:** (filled in by the agent)\n\n## Highlights\n- …\n\n## Watchlist\n- …\n\n## Regressions\n- …\n`,
        tone: "neutral",
      },
    ],
    openingPrompt:
      "Pull together this week's Monday brief: the top product events that moved last week, notable user-behavior shifts, and anything that looks like a regression. Fill in the brief.md file tile on the canvas and propose 1–2 headline tiles for the most-moved metrics.",
  },
  {
    id: "replay-digest",
    name: "Replay digest",
    tagline: "Three replays worth watching this week",
    iconId: "microphone",
    category: "research",
    description:
      "Pick three representative replays — one happy path, one friction moment, one outlier — and summarize each.",
    tiles: [
      {
        type: "note",
        size: "lg",
        body: `# Replay digest\n\n## Happy path\n_(agent will summarize a replay here)_\n\n## Friction\n_(agent will summarize a replay here)_\n\n## Outlier\n_(agent will summarize a replay here)_\n`,
        tone: "neutral",
      },
    ],
    openingPrompt:
      "Pick three session replays from the last 7 days worth me actually watching — one happy path, one friction moment, one weird outlier. Use the PostHog session-replay tools to find them, summarize each in the digest.md file tile, and propose note tiles with the share URLs.",
  },
  {
    id: "flag-hygiene",
    name: "Flag hygiene",
    tagline: "Stale and fully-rolled-out flags safe to remove",
    iconId: "flask",
    category: "engineering",
    description:
      "Audit feature flags — find the stale, fully rolled out, or unused ones safe to clean up.",
    tiles: [
      {
        type: "note",
        size: "lg",
        body: `# Flag cleanup candidates\n\n| Flag key | Reason | Action |\n| --- | --- | --- |\n| _agent will fill_ | _agent will fill_ | _agent will fill_ |\n`,
        tone: "neutral",
      },
    ],
    openingPrompt:
      "Audit our PostHog feature flags. Find the stale ones, the fully-rolled-out ones, and the ones nothing is evaluating anymore. Fill in the flags-to-remove.md table tile with each cleanup candidate, the reason, and the safe action.",
  },
  {
    id: "voice-of-customer",
    name: "Voice of customer",
    tagline: "Surface what users are actually saying",
    iconId: "megaphone",
    category: "research",
    description:
      "Synthesize what customers said in tickets, interviews, and recent feedback into themes.",
    tiles: [
      {
        type: "note",
        size: "lg",
        body: `# Voice of customer · themes\n\n## Theme 1\n_evidence_\n\n## Theme 2\n_evidence_\n\n## Theme 3\n_evidence_\n`,
        tone: "neutral",
      },
    ],
    openingPrompt:
      "Surface the strongest customer-voice themes from the last 30 days using whatever customer-feedback tools are available (PostHog comments, tickets, interviews). Fill in the themes.md tile with 3 ranked themes plus supporting evidence quotes.",
  },
  {
    id: "growth-experiment",
    name: "Growth experiment",
    tagline: "Frame a hypothesis, find the metric, plan the test",
    iconId: "rocket",
    category: "growth",
    description:
      "Set up a growth experiment: pick the metric, write the hypothesis, scope the variant.",
    tiles: [
      {
        type: "note",
        size: "md",
        body: `# Hypothesis\n\n**We believe** that …\n\n**For** _(user segment)_…\n\n**Will result in** _(measurable metric)_…\n\n**We'll know it worked when** …\n`,
        tone: "neutral",
      },
      {
        type: "note",
        size: "sm",
        body: "What's the smallest version of this test we can ship in a week?",
        tone: "blue",
      },
    ],
    openingPrompt:
      "Help me set up a growth experiment. Use the PostHog tools to find a target metric worth moving, draft a clean hypothesis in the hypothesis.md file tile, and propose a headline tile for the metric we'd track.",
  },
  {
    id: "launch-plan",
    name: "Launch plan",
    tagline: "Coordinate a feature launch end-to-end",
    iconId: "rocket",
    category: "ops",
    description:
      "Pull together a launch plan: the message, the rollout, the success metric, the comms.",
    tiles: [
      {
        type: "note",
        size: "lg",
        body: `# Launch plan\n\n## What we're shipping\n_…_\n\n## Audience & message\n_…_\n\n## Rollout\n- [ ] internal\n- [ ] beta\n- [ ] GA\n\n## Success metric\n_…_\n\n## Comms\n- [ ] blog\n- [ ] changelog\n- [ ] social\n`,
        tone: "neutral",
      },
    ],
    openingPrompt:
      "Help me draft a launch plan. Ask me what we're shipping, then propose a success-metric headline tile and fill in the launch.md template with the message, rollout phases, and comms checklist.",
  },
  {
    id: "onboarding-review",
    name: "Onboarding review",
    tagline: "Where are new users actually getting stuck?",
    iconId: "lightbulb",
    category: "product",
    description:
      "Diagnose onboarding: time-to-first-value, drop-off steps, friction signals.",
    tiles: [
      {
        type: "note",
        size: "lg",
        body: `# Onboarding review · findings\n\n## Time to first value\n_…_\n\n## Drop-off step\n_…_\n\n## Friction signals\n_…_\n\n## Recommendations\n- _…_\n`,
        tone: "neutral",
      },
    ],
    openingPrompt:
      "Diagnose our new-user onboarding. Use PostHog to measure time-to-first-value, find the drop-off step, surface friction signals from replays. Fill in onboarding-findings.md and propose a headline tile for time-to-first-value.",
  },
  {
    id: "feature-usage-analysis",
    name: "Feature usage analysis",
    tagline: "How is feature X actually being used?",
    iconId: "lightbulb",
    category: "product",
    description:
      "Pull the usage trend for a feature, segment by cohort, find power users and dabblers.",
    tiles: [
      {
        type: "headline",
        size: "md",
        label: "Weekly active users",
        fallbackValue: "—",
        fallbackDelta: "vs. prior 4 weeks",
        fallbackSparkline: [0, 0, 0, 0, 0, 0, 0],
      },
      {
        type: "note",
        size: "md",
        body: `# Feature usage analysis\n\n**Feature:** _(agent will fill)_\n\n## Adoption\n_…_\n\n## Repeat use\n_…_\n\n## Top user segments\n_…_\n\n## Stickiness (DAU/WAU)\n_…_\n`,
        tone: "neutral",
      },
      {
        type: "artifact",
        size: "sm",
        kind: "checklist",
        title: "Things to check",
        data: {
          items: [
            { text: "Pull the WAU adoption curve", done: false },
            { text: "Repeat use vs one-shot", done: false },
            { text: "Top user segments", done: false },
            { text: "Stickiness (DAU/WAU)", done: false },
          ],
        },
      },
    ],
    openingPrompt:
      "Help me analyze how a feature is actually used. Ask me which feature, then pull the weekly active users trend, segment by cohort, and identify the top users. Fill in analysis.md, update the headline tile with the real WAU number and sparkline, and check off the items as you cover them.",
  },
  {
    id: "content-calendar",
    name: "Content calendar",
    tagline: "Plan four weeks of content with PostHog-informed themes",
    iconId: "megaphone",
    category: "ops",
    description:
      "Lay out a four-week calendar across channels, with topics informed by what's worked before.",
    tiles: [
      {
        type: "artifact",
        size: "lg",
        kind: "table",
        title: "Schedule",
        data: {
          headers: ["Week", "Date", "Channel", "Topic", "Owner"],
          rows: [
            ["1", "—", "—", "—", "—"],
            ["2", "—", "—", "—", "—"],
            ["3", "—", "—", "—", "—"],
            ["4", "—", "—", "—", "—"],
          ],
        },
      },
      {
        type: "note",
        size: "md",
        body: `# Content themes\n\n## Channels\n- _…_\n\n## Cadence\n_…_\n\n## Theme 1\n_…_\n\n## Theme 2\n_…_\n\n## Theme 3\n_…_\n`,
        tone: "neutral",
      },
      {
        type: "note",
        size: "sm",
        body: "Lean into the topics that already drove the most signups — PostHog can tell us which.",
        tone: "blue",
      },
    ],
    openingPrompt:
      "Help me build a four-week content calendar. Ask me which channels and what cadence, then suggest topics based on what's performed well in PostHog (blog views, signups by referrer, etc.). Fill the Schedule table and themes.md.",
  },
  {
    id: "sprint-plan",
    name: "Sprint plan",
    tagline: "Two-week sprint plan with goals, work items, and capacity",
    iconId: "rocket",
    category: "engineering",
    description:
      "Draft sprint goals, scope work items, sanity-check capacity, and surface what's worth pulling in.",
    tiles: [
      {
        type: "artifact",
        size: "md",
        kind: "checklist",
        title: "Sprint goals",
        data: {
          items: [
            { text: "Goal 1", done: false },
            { text: "Goal 2", done: false },
            { text: "Goal 3", done: false },
          ],
        },
      },
      {
        type: "artifact",
        size: "lg",
        kind: "table",
        title: "Work items",
        data: {
          headers: ["Item", "Owner", "Size", "Status"],
          rows: [
            ["—", "—", "—", "Todo"],
            ["—", "—", "—", "Todo"],
            ["—", "—", "—", "Todo"],
          ],
        },
      },
      {
        type: "note",
        size: "md",
        body: `# Sprint plan\n\n**Dates:** _(agent will fill)_\n\n## Goals\n_…_\n\n## Scope\n- _…_\n\n## Risks\n- _…_\n\n## Out of scope\n- _…_\n`,
        tone: "neutral",
      },
      {
        type: "note",
        size: "sm",
        body: "Capacity check: count the holidays / on-call / vacation before committing.",
        tone: "blue",
      },
    ],
    openingPrompt:
      "Help me plan the next two-week sprint. Ask me for the headline goal and team capacity, then suggest candidate items from recent git history and PostHog product data (bugs, regressions, feature gaps). Fill in the Sprint goals checklist, the Work items table, and sprint.md.",
  },
  {
    id: "onboarding-diagnostic",
    name: "Onboarding diagnostic",
    tagline: "Find where new users are actually getting stuck",
    iconId: "compass",
    category: "product",
    description:
      "Measure time-to-first-value, drop-off, friction signals from replays.",
    tiles: [
      {
        type: "headline",
        size: "md",
        label: "Time to first value",
        fallbackValue: "—",
        fallbackDelta: "vs. prior 4 weeks",
        fallbackSparkline: [0, 0, 0, 0, 0, 0, 0],
      },
      {
        type: "note",
        size: "md",
        body: `# Onboarding diagnostic\n\n## Time to first value\n_…_\n\n## Biggest drop-off step\n_…_\n\n## Friction signals\n_…_\n\n## Recommendations\n- _…_\n`,
        tone: "neutral",
      },
      {
        type: "artifact",
        size: "sm",
        kind: "checklist",
        title: "Audit steps",
        data: {
          items: [
            { text: "Confirm the activation event definition", done: false },
            { text: "Check by acquisition source", done: false },
            { text: "Sample 3 replays at the drop-off step", done: false },
            { text: "Compare to last month", done: false },
          ],
        },
      },
    ],
    openingPrompt:
      "Diagnose our new-user onboarding. Use PostHog to measure time-to-first-value, find the worst drop-off step, and surface friction signals from session replays. Fill in findings.md, update the headline tile with the real TTV number, and propose an insight tile for the funnel.",
  },
  {
    id: "retention-deep-dive",
    name: "Retention deep-dive",
    tagline: "D1/D7/D30 retention and what's driving it",
    iconId: "target",
    category: "product",
    description:
      "Pull retention curves, break down by cohort and feature, find the strongest retention driver.",
    tiles: [
      {
        type: "headline",
        size: "md",
        label: "D7 retention",
        fallbackValue: "—",
        fallbackDelta: "vs. prior cohort",
        fallbackSparkline: [0, 0, 0, 0, 0, 0, 0],
      },
      {
        type: "note",
        size: "lg",
        body: `# Retention deep-dive\n\n## Curves\n- D1: _…_\n- D7: _…_\n- D30: _…_\n\n## Cohorts\n_…_\n\n## Strongest driver\n_…_\n\n## Recommendations\n- _…_\n`,
        tone: "neutral",
      },
      {
        type: "note",
        size: "sm",
        body: "Hypothesis: power-user actions in week 1 drive 30-day retention.",
        tone: "green",
      },
    ],
    openingPrompt:
      "Run a D1/D7/D30 retention deep-dive. Pull the curves from PostHog, segment by cohort and key feature usage, and identify the strongest driver of long-term retention. Fill in retention-findings.md and update the headline tile with the real D7 number.",
  },
  {
    id: "product-market-fit-check",
    name: "Product-market fit check",
    tagline: "Is this something people would be very disappointed without?",
    iconId: "flask",
    category: "research",
    description:
      "Run the PMF skill, surface the 40% threshold, list power users worth interviewing.",
    tiles: [
      {
        type: "note",
        size: "md",
        body: `# PMF action plan\n\n**Current score:** _(agent will fill)_\n\n## What's working\n_…_\n\n## What to fix\n_…_\n\n## Next actions\n1. _…_\n2. _…_\n3. _…_\n`,
        tone: "neutral",
      },
      {
        type: "note",
        size: "sm",
        body: "Threshold reminder: ≥40% 'very disappointed' is the bar.",
        tone: "yellow",
      },
    ],
    openingPrompt:
      "Use the product-market-fit skill to set up or read the latest PMF survey results in PostHog, then propose 2–3 concrete next actions in pmf-action-plan.md.",
  },
  {
    id: "competitor-intel",
    name: "Competitor intel digest",
    tagline: "What competitors shipped this week",
    iconId: "compass",
    category: "growth",
    description:
      "A weekly digest of what competitors changed — features, pricing, positioning.",
    tiles: [
      {
        type: "note",
        size: "md",
        body: `# Competitor digest\n\n**Week of:** _(agent will fill)_\n\n## Notable changes\n- _…_\n\n## Implications for us\n- _…_\n\n## Top takeaway\n_…_\n`,
        tone: "neutral",
      },
      {
        type: "note",
        size: "sm",
        body: "Top action this week: _(agent will fill)_",
        tone: "yellow",
      },
    ],
    openingPrompt:
      "Use the competitor-changelog-tracker skill to surface recent competitor changes, then synthesize 1–2 takeaways into digest.md and put the single top action in the note tile.",
  },
  {
    id: "power-users-to-interview",
    name: "Power users to interview",
    tagline: "Find your best users and set up interviews",
    iconId: "microphone",
    category: "research",
    description:
      "Identify power users from PostHog, save a cohort, prep interview questions.",
    tiles: [
      {
        type: "note",
        size: "md",
        body: `# Interview prep\n\n## Who\n_(agent will list top 5–10 candidates with one-line context each)_\n\n## Why these users\n_…_\n\n## Questions\n1. _…_\n2. _…_\n3. _…_\n`,
        tone: "neutral",
      },
      {
        type: "artifact",
        size: "sm",
        kind: "checklist",
        title: "Outreach steps",
        data: {
          items: [
            { text: "Draft outreach email", done: false },
            { text: "Send to top 10", done: false },
            { text: "Schedule 5 calls", done: false },
            { text: "Send recap to the team", done: false },
          ],
        },
      },
    ],
    openingPrompt:
      "Use the power-user-discovery skill to find our top power users and save them as a PostHog cohort, then draft an interview guide in interview-prep.md based on what makes them power users.",
  },
  {
    id: "weekly-slack-digest",
    name: "Weekly Slack digest",
    tagline: "What you missed in Slack this week",
    iconId: "megaphone",
    category: "ops",
    description:
      "A short digest of long threads, unresolved debates, and important decisions from the last 7 days.",
    tiles: [
      {
        type: "note",
        size: "md",
        body: `# Weekly Slack digest\n\n**Week of:** _(agent will fill)_\n\n## Important threads\n- _…_\n\n## Unresolved\n- _…_\n\n## Decisions made\n- _…_\n`,
        tone: "neutral",
      },
      {
        type: "note",
        size: "sm",
        body: "Top action item: _(agent will fill)_",
        tone: "blue",
      },
    ],
    openingPrompt:
      "Use the important-slack-threads skill to scan the last 7 days, then pick the single most-important action item and put it in the note tile.",
  },
  {
    id: "customer-discovery",
    name: "Customer discovery",
    tagline: "Talk to 5 customers, find the next bet",
    iconId: "target",
    category: "growth",
    description:
      "Plan and run a round of customer discovery calls to surface the next growth bet.",
    tiles: [
      {
        type: "artifact",
        size: "md",
        kind: "checklist",
        title: "Discovery steps",
        data: {
          items: [
            { text: "Define the hypothesis", done: false },
            { text: "Pick 5 users to talk to", done: false },
            { text: "Send outreach", done: false },
            { text: "Run the calls", done: false },
            { text: "Synthesize themes", done: false },
          ],
        },
      },
      {
        type: "note",
        size: "md",
        body: `# Customer discovery notes\n\n## Hypothesis\n_…_\n\n## Calls\n### Call 1\n_…_\n\n### Call 2\n_…_\n\n## Themes\n- _…_\n\n## Next bet\n_…_\n`,
        tone: "neutral",
      },
      {
        type: "note",
        size: "sm",
        body: "Bias: lead with open questions, never with the feature.",
        tone: "pink",
      },
    ],
    openingPrompt:
      "Help me run a customer discovery round. Ask what I'm investigating, suggest 5 users to talk to (use the power-user-discovery skill if helpful), and draft discovery-notes.md plus the outreach steps.",
  },
];

export function getTemplateById(id: string): ProjectTemplate | null {
  return PROJECT_TEMPLATES.find((t) => t.id === id) ?? null;
}
