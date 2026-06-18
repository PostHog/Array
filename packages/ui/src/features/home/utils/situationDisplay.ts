import {
  ArrowUUpLeft,
  ChatCircleDots,
  CheckCircle,
  Clock,
  Eye,
  GitCommit,
  GitMerge,
  type Icon,
  XCircle,
} from "@phosphor-icons/react";
import { SITUATIONS, type SituationId } from "@posthog/core/workflow/schemas";

// Radix color scales the status system uses, each mapping to the full
// `--<color>-{1..12}` + `--<color>-a{1..12}` token families.
export type SituationColor =
  | "red"
  | "orange"
  | "amber"
  | "green"
  | "blue"
  | "purple"
  | "gray";

export interface SituationVisual {
  label: string;
  description: string;
  /** Radix color scale that gives this situation its identity. */
  color: SituationColor;
  /** Phosphor glyph rendered in the status badge / chip. */
  Icon: Icon;
}

// Colour + glyph each situation reads as: cool hues = work in flight, warm =
// "your move", green = go, gray = dormant. Adjacent board columns stay distinct.
const SITUATION_STYLE: Record<
  SituationId,
  { color: SituationColor; Icon: Icon }
> = {
  working: { color: "purple", Icon: GitCommit },
  in_review: { color: "blue", Icon: Eye },
  ci_failing: { color: "red", Icon: XCircle },
  changes_requested: { color: "orange", Icon: ArrowUUpLeft },
  comments_waiting: { color: "amber", Icon: ChatCircleDots },
  ready_to_merge: { color: "green", Icon: GitMerge },
  stale: { color: "gray", Icon: Clock },
  done: { color: "gray", Icon: CheckCircle },
};

export const SITUATION_VISUAL: Record<SituationId, SituationVisual> =
  Object.fromEntries(
    SITUATIONS.map((s) => [
      s.id,
      { label: s.label, description: s.description, ...SITUATION_STYLE[s.id] },
    ]),
  ) as Record<SituationId, SituationVisual>;

/** CSS-var passthroughs for a colour scale – used in inline `style`. */
export interface SituationCss {
  /** Readable text / icon colour, also good on a tinted fill (`--c-11`). */
  fg: string;
  /** Saturated solid – dots and accent rails (`--c-9`). */
  solid: string;
  /** Soft translucent fill for chips / glyph backgrounds (`--c-a3`). */
  tint: string;
  /** Slightly stronger fill for hover / wells (`--c-a4`). */
  tintStrong: string;
  /** Hairline border that reads as the colour (`--c-a6`). */
  border: string;
  /** Whisper-faint column wash (`--c-a2`). */
  wash: string;
}

export function situationCss(color: SituationColor): SituationCss {
  return {
    fg: `var(--${color}-11)`,
    solid: `var(--${color}-9)`,
    tint: `var(--${color}-a3)`,
    tintStrong: `var(--${color}-a4)`,
    border: `var(--${color}-a6)`,
    wash: `var(--${color}-a2)`,
  };
}
