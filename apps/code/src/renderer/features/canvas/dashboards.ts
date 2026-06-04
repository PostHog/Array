// Mock website-data dashboards. Stand-ins until real dashboards are wired —
// each renders a set of stat tiles. The active dashboard is driven by the
// /website/dashboards/$dashboardId route param.

export interface DashboardTile {
  label: string;
  value: string;
  delta?: string;
  trend?: "up" | "down";
}

export interface Dashboard {
  id: string;
  name: string;
  tiles: DashboardTile[];
}

export const WEBSITE_DASHBOARDS: Dashboard[] = [
  {
    id: "traffic",
    name: "Traffic overview",
    tiles: [
      { label: "Visitors", value: "48.2k", delta: "+12.4%", trend: "up" },
      { label: "Pageviews", value: "182k", delta: "+8.1%", trend: "up" },
      { label: "Avg. session", value: "2m 41s", delta: "+5s", trend: "up" },
      { label: "Bounce rate", value: "38.6%", delta: "-2.3%", trend: "down" },
    ],
  },
  {
    id: "acquisition",
    name: "Acquisition",
    tiles: [
      { label: "New users", value: "12.9k", delta: "+18.2%", trend: "up" },
      { label: "Top source", value: "Organic" },
      { label: "Signups", value: "1,204", delta: "+9.7%", trend: "up" },
      { label: "Referrals", value: "3,418", delta: "-1.1%", trend: "down" },
    ],
  },
  {
    id: "engagement",
    name: "Engagement",
    tiles: [
      { label: "DAU", value: "8,310", delta: "+4.6%", trend: "up" },
      { label: "WAU", value: "29,540", delta: "+6.2%", trend: "up" },
      { label: "Stickiness", value: "28.1%", delta: "+1.4%", trend: "up" },
      { label: "Sessions / user", value: "3.2", delta: "+0.2", trend: "up" },
    ],
  },
  {
    id: "conversion",
    name: "Conversion funnel",
    tiles: [
      { label: "Visits", value: "48.2k" },
      { label: "Signups", value: "1,204", delta: "2.5%", trend: "up" },
      { label: "Activated", value: "742", delta: "1.5%", trend: "up" },
      { label: "Paid", value: "188", delta: "0.39%", trend: "down" },
    ],
  },
  {
    id: "performance",
    name: "Web performance",
    tiles: [
      { label: "LCP", value: "1.8s", delta: "-0.2s", trend: "down" },
      { label: "CLS", value: "0.04", delta: "-0.01", trend: "down" },
      { label: "INP", value: "164ms", delta: "+12ms", trend: "up" },
      { label: "Error rate", value: "0.7%", delta: "-0.1%", trend: "down" },
    ],
  },
];

export const DEFAULT_DASHBOARD_ID = WEBSITE_DASHBOARDS[0].id;

export function getDashboard(id: string | undefined): Dashboard {
  return WEBSITE_DASHBOARDS.find((d) => d.id === id) ?? WEBSITE_DASHBOARDS[0];
}
