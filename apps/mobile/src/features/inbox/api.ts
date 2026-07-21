import { selectReportRepository } from "@posthog/core/inbox/reportArtefacts";
import { getPostHogApiClient } from "@/lib/posthogApiClient";

/** Resolve the repository associated with a signal report via its repo_selection artefact. */
export async function getReportRepository(
  reportId: string,
): Promise<string | null> {
  const { results } =
    await getPostHogApiClient().getSignalReportArtefacts(reportId);
  return selectReportRepository(results);
}
