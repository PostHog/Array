import { Badge } from "@posthog/quill";
import type { SituationId } from "@shared/types/workflow";
import { SITUATION_BADGE, SITUATION_META } from "../utils/situationDisplay";

interface Props {
  sid: SituationId;
}

export function SituationChip({ sid }: Props) {
  const meta = SITUATION_META[sid];
  return (
    <Badge variant={SITUATION_BADGE[sid]} title={meta.description}>
      {meta.label}
    </Badge>
  );
}
