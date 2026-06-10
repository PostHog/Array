import type { SituationId } from "@posthog/core/workflow/schemas";
import {
  SITUATION_VISUAL,
  situationCss,
} from "@posthog/ui/features/home/utils/situationDisplay";

interface Props {
  sid: SituationId;
  /** Hide the leading glyph (e.g. when the chip sits next to a status icon). */
  showIcon?: boolean;
}

export function SituationChip({ sid, showIcon = true }: Props) {
  const v = SITUATION_VISUAL[sid];
  const c = situationCss(v.color);
  const Icon = v.Icon;
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 font-medium text-[10.5px] leading-none"
      style={{ color: c.fg, backgroundColor: c.tint }}
      title={v.description}
    >
      {showIcon ? <Icon size={10} weight="fill" /> : null}
      {v.label}
    </span>
  );
}
