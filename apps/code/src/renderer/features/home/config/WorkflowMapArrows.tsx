import {
  FLOW_ARROWS,
  MAP_HEIGHT,
  MAP_WIDTH,
  STATION_LAYOUT,
  stationCentre,
} from "./workflowMapLayout";

// Decorative flow arrows between stations — not runtime edges (see
// `FLOW_ARROWS` in workflowMapLayout.ts).
export function WorkflowMapArrows() {
  return (
    <svg
      width={MAP_WIDTH}
      height={MAP_HEIGHT}
      viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
      className="pointer-events-none absolute inset-0"
      aria-hidden="true"
    >
      <defs>
        <marker
          id="wf-arrowhead"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L10,5 L0,10 z" className="fill-(--gray-9)" />
        </marker>
        <marker
          id="wf-arrowhead-dim"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L10,5 L0,10 z" className="fill-(--gray-8)" />
        </marker>
      </defs>

      {FLOW_ARROWS.map((arrow) => {
        const a = STATION_LAYOUT[arrow.from];
        const b = STATION_LAYOUT[arrow.to];
        const ca = stationCentre(a);
        const cb = stationCentre(b);

        // Start/end on the rectangle edges along the direction of travel, so
        // the line doesn't run under the station card.
        const start = edgePoint(a, cb);
        const end = edgePoint(b, ca);

        // Slight curve via a quadratic Bézier — control point offset perpendicular from the midpoint.
        const mx = (start.x + end.x) / 2;
        const my = (start.y + end.y) / 2;
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const len = Math.max(1, Math.hypot(dx, dy));
        const perp = { x: -dy / len, y: dx / len };
        const curveAmount = arrow.kind === "branch" ? 28 : 12;
        const cx = mx + perp.x * curveAmount;
        const cy = my + perp.y * curveAmount;

        const path = `M ${start.x},${start.y} Q ${cx},${cy} ${end.x},${end.y}`;
        const dim = arrow.kind === "branch";

        return (
          <path
            key={`${arrow.from}->${arrow.to}`}
            d={path}
            fill="none"
            strokeWidth={dim ? 1 : 1.5}
            strokeDasharray={dim ? "4 4" : "none"}
            className={dim ? "stroke-(--gray-8)" : "stroke-(--gray-9)"}
            markerEnd={`url(#wf-arrowhead${dim ? "-dim" : ""})`}
          />
        );
      })}
    </svg>
  );
}

// Returns the point on the rectangle's perimeter closest to a target,
// clipped along the ray from the rectangle's centre toward the target.
function edgePoint(
  rect: { x: number; y: number; w: number; h: number },
  target: { x: number; y: number },
): { x: number; y: number } {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const dx = target.x - cx;
  const dy = target.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };

  const halfW = rect.w / 2;
  const halfH = rect.h / 2;
  const tx = dx === 0 ? Number.POSITIVE_INFINITY : halfW / Math.abs(dx);
  const ty = dy === 0 ? Number.POSITIVE_INFINITY : halfH / Math.abs(dy);
  const t = Math.min(tx, ty);
  return { x: cx + dx * t, y: cy + dy * t };
}
