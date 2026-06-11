import type {
  LlmSkillListItem,
  PostHogAPIClient,
} from "@posthog/api-client/posthog-client";
import { injectable } from "inversify";

export interface TeamSkillInfo {
  id: string;
  name: string;
  description: string;
  version: number;
  updatedAt: string;
  createdByEmail: string | null;
  /** A local skill with the same name already exists on this machine. */
  installedLocally: boolean;
}

export interface TeamSkillsListing {
  /** False when the org does not have the team-skills feature enabled. */
  available: boolean;
  skills: TeamSkillInfo[];
}

@injectable()
export class TeamSkillsService {
  /**
   * Lists team skills merged with the local listing: the availability
   * decision (flag off → absent group, no errors) and the "already
   * installed locally" marking both live here, so the UI keeps one hook.
   */
  async listTeamSkills(
    client: PostHogAPIClient,
    localSkillNames: string[],
  ): Promise<TeamSkillsListing> {
    const items = await client.listLlmSkills();
    if (items === null) {
      return { available: false, skills: [] };
    }
    const localNames = new Set(localSkillNames);
    return {
      available: true,
      skills: items
        .filter((item) => item.is_latest)
        .map((item) => toTeamSkillInfo(item, localNames)),
    };
  }
}

function toTeamSkillInfo(
  item: LlmSkillListItem,
  localNames: Set<string>,
): TeamSkillInfo {
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    version: item.latest_version ?? item.version,
    updatedAt: item.updated_at,
    createdByEmail: item.created_by?.email ?? null,
    installedLocally: localNames.has(item.name),
  };
}
