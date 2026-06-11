import type { Spec } from "@json-render/react";

// Name of the built-in showcase canvas. Seeding dedupes on this exact name, so
// don't change it without a migration (a rename reseeds a second copy).
export const SHOWCASE_CANVAS_NAME = "Dashboard component Showcase";

// A static, code-shipped canvas spec that exercises every Dashboard-template
// component with realistic sample data. Seeded into a channel as a real saved
// canvas (see useSeedShowcase) so anyone opening the canvases grid sees a
// working board and can confirm each component renders. Pure fixture — no live
// queries (so refresh is a no-op), identical for every user.
export const SHOWCASE_SPEC: Spec = {
  root: "page",
  elements: {
    page: {
      type: "Page",
      props: {},
      children: [
        "title",
        "h_metrics",
        "g_stats",
        "h_trends",
        "g_trends",
        "card_spark",
        "h_breakdown",
        "g_breakdown",
        "h_data",
        "g_data",
        "h_components",
        "g_components",
      ],
    },
    title: {
      type: "Heading",
      props: { text: "Dashboard component Showcase", level: 1 },
      children: [],
    },

    // --- Stats -------------------------------------------------------------
    h_metrics: {
      type: "Heading",
      props: { text: "Key metrics", level: 2 },
      children: [],
    },
    g_stats: {
      type: "Grid",
      props: { columns: 4 },
      children: ["stat_pageviews", "stat_users", "stat_sessions", "stat_dur"],
    },
    stat_pageviews: {
      type: "Stat",
      props: { label: "Pageviews", value: 34980058, delta: "+12.4%" },
      children: [],
    },
    stat_users: {
      type: "Stat",
      props: { label: "Unique users", value: 1284091, delta: "+3.1%" },
      children: [],
    },
    stat_sessions: {
      type: "Stat",
      props: { label: "Sessions", value: 2910433, delta: "-1.2%" },
      children: [],
    },
    stat_dur: {
      type: "Stat",
      props: { label: "Avg. duration", value: "4m 12s", delta: "+0.8%" },
      children: [],
    },

    // --- Trends (Line / Bar / Sparkline) -----------------------------------
    h_trends: {
      type: "Heading",
      props: { text: "Trends", level: 2 },
      children: [],
    },
    g_trends: {
      type: "Grid",
      props: { columns: 2 },
      children: ["card_line", "card_bar"],
    },
    card_line: {
      type: "Card",
      props: { title: "Signups vs activations (14d)" },
      children: ["chart_line"],
    },
    chart_line: {
      type: "LineChart",
      props: {
        labels: [
          "1",
          "2",
          "3",
          "4",
          "5",
          "6",
          "7",
          "8",
          "9",
          "10",
          "11",
          "12",
          "13",
          "14",
        ],
        series: [
          {
            label: "Signups",
            data: [12, 18, 15, 22, 28, 24, 31, 35, 29, 38, 42, 39, 45, 51],
          },
          {
            label: "Activations",
            data: [5, 9, 7, 12, 15, 13, 18, 21, 17, 24, 27, 25, 29, 33],
          },
        ],
      },
      children: [],
    },
    card_bar: {
      type: "Card",
      props: { title: "Events by day" },
      children: ["chart_bar"],
    },
    chart_bar: {
      type: "BarChart",
      props: {
        labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
        series: [
          { label: "Web", data: [320, 410, 380, 450, 500, 210, 180] },
          { label: "Mobile", data: [210, 260, 240, 300, 330, 140, 120] },
        ],
      },
      children: [],
    },
    card_spark: {
      type: "Card",
      props: { title: "p95 latency (24h)" },
      children: ["chart_spark"],
    },
    chart_spark: {
      type: "Sparkline",
      props: {
        data: [
          42, 44, 41, 47, 52, 49, 55, 53, 58, 54, 60, 57, 62, 59, 64, 61, 66,
          63, 68, 65,
        ],
      },
      children: [],
    },

    // --- Breakdown (Pie / Progress) ----------------------------------------
    h_breakdown: {
      type: "Heading",
      props: { text: "Breakdown", level: 2 },
      children: [],
    },
    g_breakdown: {
      type: "Grid",
      props: { columns: 2 },
      children: ["card_pie", "card_progress"],
    },
    card_pie: {
      type: "Card",
      props: { title: "Sessions by browser" },
      children: ["chart_pie"],
    },
    chart_pie: {
      type: "PieChart",
      props: {
        items: [
          { label: "Chrome", value: 62 },
          { label: "Safari", value: 21 },
          { label: "Firefox", value: 9 },
          { label: "Edge", value: 8 },
        ],
      },
      children: [],
    },
    card_progress: {
      type: "Card",
      props: { title: "Quarterly goals" },
      children: ["prog_mau", "prog_rev", "prog_onb"],
    },
    prog_mau: {
      type: "Progress",
      props: { label: "MAU target", value: 68 },
      children: [],
    },
    prog_rev: {
      type: "Progress",
      props: { label: "Revenue target", value: 84 },
      children: [],
    },
    prog_onb: {
      type: "Progress",
      props: { label: "Onboarding completion", value: 42 },
      children: [],
    },

    // --- Tables & lists -----------------------------------------------------
    h_data: {
      type: "Heading",
      props: { text: "Tables & lists", level: 2 },
      children: [],
    },
    g_data: {
      type: "Grid",
      props: { columns: 2 },
      children: ["card_table", "card_barlist"],
    },
    card_table: {
      type: "Card",
      props: { title: "Top pages" },
      children: ["table_pages"],
    },
    table_pages: {
      type: "Table",
      props: {
        columns: ["Page", "Views", "Bounce"],
        rows: [
          ["/", 91204, "32%"],
          ["/pricing", 41201, "28%"],
          ["/docs", 38109, "19%"],
          ["/blog", 22904, "44%"],
        ],
      },
      children: [],
    },
    card_barlist: {
      type: "Card",
      props: { title: "Top referrers" },
      children: ["barlist_ref"],
    },
    barlist_ref: {
      type: "BarList",
      props: {
        items: [
          { label: "google.com", value: 48201 },
          { label: "twitter.com", value: 18230 },
          { label: "github.com", value: 12044 },
          { label: "direct", value: 9120 },
        ],
      },
      children: [],
    },

    // --- Misc components (Badge / Text / Button / Divider / inputs) ---------
    h_components: {
      type: "Heading",
      props: { text: "Components", level: 2 },
      children: [],
    },
    g_components: {
      type: "Grid",
      props: { columns: 2 },
      children: ["card_badges", "card_inputs"],
    },
    card_badges: {
      type: "Card",
      props: { title: "Badges, text, button, divider" },
      children: [
        "badge_grid",
        "div_1",
        "text_normal",
        "text_muted",
        "button_primary",
      ],
    },
    badge_grid: {
      type: "Grid",
      props: { columns: 3 },
      children: [
        "badge_gray",
        "badge_green",
        "badge_red",
        "badge_amber",
        "badge_blue",
      ],
    },
    badge_gray: {
      type: "Badge",
      props: { text: "Default", color: "gray" },
      children: [],
    },
    badge_green: {
      type: "Badge",
      props: { text: "Healthy", color: "green" },
      children: [],
    },
    badge_red: {
      type: "Badge",
      props: { text: "Error", color: "red" },
      children: [],
    },
    badge_amber: {
      type: "Badge",
      props: { text: "Warning", color: "amber" },
      children: [],
    },
    badge_blue: {
      type: "Badge",
      props: { text: "Info", color: "blue" },
      children: [],
    },
    div_1: { type: "Divider", props: {}, children: [] },
    text_normal: {
      type: "Text",
      props: { text: "Body text renders here." },
      children: [],
    },
    text_muted: {
      type: "Text",
      props: { text: "Muted helper text.", muted: true },
      children: [],
    },
    button_primary: {
      type: "Button",
      props: { text: "Primary action", variant: "primary" },
      children: [],
    },
    card_inputs: {
      type: "Card",
      props: { title: "Inputs" },
      children: ["input_search", "check_active"],
    },
    input_search: {
      type: "TextInput",
      props: { label: "Search", placeholder: "Type to filter…" },
      children: [],
    },
    check_active: {
      type: "Checkbox",
      props: { label: "Only active users" },
      children: [],
    },
  },
};
