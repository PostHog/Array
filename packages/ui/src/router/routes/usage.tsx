import { createFileRoute, redirect } from "@tanstack/react-router";

// The standalone Usage tab merged into Settings → Plan & usage. Keep the
// route as a redirect so restored windows and stale history entries land
// on the merged page instead of a not-found screen.
export const Route = createFileRoute("/usage")({
  beforeLoad: () => {
    throw redirect({
      to: "/settings/$category",
      params: { category: "plan-usage" },
      replace: true,
    });
  },
});
