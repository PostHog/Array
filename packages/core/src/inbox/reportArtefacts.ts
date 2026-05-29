import type {
  ActionabilityJudgmentArtefact,
  ActionabilityJudgmentContent,
  PriorityJudgmentArtefact,
  SignalFindingArtefact,
  SignalReportArtefactsResponse,
  SuggestedReviewer,
  SuggestedReviewersArtefact,
} from "@posthog/shared/domain-types";

type ReportArtefact = SignalReportArtefactsResponse["results"][number];

export function selectSuggestedReviewers(
  artefacts: ReportArtefact[],
  meUuid?: string,
): SuggestedReviewer[] {
  const artefact = artefacts.find(
    (a): a is SuggestedReviewersArtefact => a.type === "suggested_reviewers",
  );
  const reviewers = artefact?.content ?? [];
  if (!meUuid) return reviewers;
  const meIndex = reviewers.findIndex((r) => r.user?.uuid === meUuid);
  if (meIndex <= 0) return reviewers;
  return [reviewers[meIndex], ...reviewers.filter((_, i) => i !== meIndex)];
}

export function buildSignalFindingMap(
  artefacts: ReportArtefact[],
): Map<string, SignalFindingArtefact["content"]> {
  const map = new Map<string, SignalFindingArtefact["content"]>();
  for (const a of artefacts) {
    if (a.type === "signal_finding") {
      const finding = a as SignalFindingArtefact;
      map.set(finding.content.signal_id, finding.content);
    }
  }
  return map;
}

export function selectActionabilityJudgment(
  artefacts: ReportArtefact[],
): ActionabilityJudgmentContent | null {
  for (const a of artefacts) {
    if (a.type === "actionability_judgment") {
      return (a as ActionabilityJudgmentArtefact).content;
    }
  }
  return null;
}

export function selectPriorityExplanation(
  artefacts: ReportArtefact[],
): string | null {
  for (const a of artefacts) {
    if (a.type === "priority_judgment") {
      return (a as PriorityJudgmentArtefact).content.explanation || null;
    }
  }
  return null;
}
