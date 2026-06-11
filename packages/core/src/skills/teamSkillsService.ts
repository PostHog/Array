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

export interface ExportedSkill {
  name: string;
  description: string;
  body: string;
  files: { path: string; content: string }[];
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

  /**
   * Publishes a local skill to the team: creates the LLMSkill on first
   * publish, otherwise publishes a new version against the current latest
   * (versioning comes free from the model's version/is_latest).
   */
  async publishSkill(
    client: PostHogAPIClient,
    exported: ExportedSkill,
  ): Promise<{ version: number }> {
    if (!exported.name.trim()) {
      throw new Error("The skill needs a name before it can be published");
    }
    if (!exported.description.trim()) {
      throw new Error(
        "Add a description before publishing — teammates' agents rely on it",
      );
    }

    const items = await client.listLlmSkills();
    if (items === null) {
      throw new Error("Team skills are not enabled for this organization");
    }
    const existing = items.find(
      (item) => item.name === exported.name && item.is_latest,
    );

    const published = existing
      ? await client.publishLlmSkillVersion(exported.name, {
          body: exported.body,
          description: exported.description,
          files: exported.files,
          base_version: existing.latest_version ?? existing.version,
        })
      : await client.createLlmSkill({
          name: exported.name,
          description: exported.description,
          body: exported.body,
          files: exported.files,
        });

    return { version: published.version };
  }

  /**
   * Fetches everything needed to materialize a team skill on disk: the
   * latest body plus every companion file's content.
   */
  async fetchSkillForInstall(
    client: PostHogAPIClient,
    name: string,
  ): Promise<ExportedSkill> {
    const detail = await client.getLlmSkillByName(name);
    const files = await Promise.all(
      detail.files.map(async (manifest) => {
        const file = await client.getLlmSkillFile(name, manifest.path);
        return { path: file.path, content: file.content };
      }),
    );
    return {
      name: detail.name,
      description: detail.description,
      body: detail.body,
      files,
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
