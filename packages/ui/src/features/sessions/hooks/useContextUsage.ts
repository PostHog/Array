import {
  type ContextBreakdown,
  type ContextUsage,
  extractContextUsage,
} from "@posthog/core/sessions/contextUsage";
import type { AcpMessage } from "@posthog/shared";
import { useMemo } from "react";

export type { ContextBreakdown, ContextUsage };

export function useContextUsage(events: AcpMessage[]): ContextUsage | null {
  return useMemo(() => extractContextUsage(events), [events]);
}
