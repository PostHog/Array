import { useSelectProjectMutation } from "@features/auth/hooks/authMutations";
import { useAuthStateValue } from "@features/auth/hooks/authQueries";
import type { OrgProjectsMap } from "@main/services/auth/schemas";
import { logger } from "@utils/logger";
import { useEffect, useMemo } from "react";

const log = logger.scope("useProjects");

export interface ProjectInfo {
  id: number;
  name: string;
  organization: { id: string; name: string };
}

export interface GroupedProjects {
  orgId: string;
  orgName: string;
  projects: ProjectInfo[];
}

export function groupProjectsByOrg(map: OrgProjectsMap): GroupedProjects[] {
  return Object.entries(map).map(([orgId, org]) => ({
    orgId,
    orgName: org.orgName,
    projects: org.projects.map((p) => ({
      id: p.id,
      name: p.name,
      organization: { id: orgId, name: org.orgName },
    })),
  }));
}

export function useProjects() {
  const orgProjectsMap = useAuthStateValue((state) => state.orgProjectsMap);
  const currentOrgId = useAuthStateValue((state) => state.currentOrgId);
  const currentProjectId = useAuthStateValue((state) => state.currentProjectId);

  const projects = useMemo<ProjectInfo[]>(() => {
    return Object.entries(orgProjectsMap).flatMap(([orgId, org]) =>
      org.projects.map((p) => ({
        id: p.id,
        name: p.name,
        organization: { id: orgId, name: org.orgName },
      })),
    );
  }, [orgProjectsMap]);

  const { mutate: selectProject, isPending: isSelectingProject } =
    useSelectProjectMutation();
  const currentProject = projects.find((p) => p.id === currentProjectId);
  const groupedProjects = useMemo(
    () => groupProjectsByOrg(orgProjectsMap),
    [orgProjectsMap],
  );

  useEffect(() => {
    if (isSelectingProject) return;
    if (projects.length === 0 || currentProject) return;
    const currentOrgProjects = currentOrgId
      ? (orgProjectsMap[currentOrgId]?.projects ?? [])
      : [];
    const preferredId = currentOrgProjects[0]?.id;
    if (preferredId == null) return;
    log.info("Auto-selecting project in current org", {
      projectId: preferredId,
      reason:
        currentProjectId == null
          ? "no project selected"
          : "current project not found in list",
    });
    selectProject(preferredId);
  }, [
    currentProject,
    currentProjectId,
    currentOrgId,
    orgProjectsMap,
    projects.length,
    selectProject,
    isSelectingProject,
  ]);

  return {
    projects,
    groupedProjects,
    currentProject,
    currentProjectId,
  };
}
