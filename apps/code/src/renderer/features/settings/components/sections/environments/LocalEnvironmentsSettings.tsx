import { useFolders } from "@features/folders/hooks/useFolders";
import { useSettingsDialogStore } from "@features/settings/stores/settingsDialogStore";
import type { Environment } from "@main/services/environment/schemas";
import type { RegisteredFolder } from "@main/services/folders/schemas";
import { Flex, Text } from "@radix-ui/themes";
import { useTRPC } from "@renderer/trpc/client";
import { useQueries } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EnvironmentForm } from "./EnvironmentForm";
import { ProjectEnvironmentCard } from "./ProjectEnvironmentCard";

export interface ProjectEnvironments {
  folder: RegisteredFolder;
  environments: Environment[];
  isLoading: boolean;
}

interface FormTarget {
  folder: RegisteredFolder;
  environment?: Environment;
}

export function LocalEnvironmentsSettings() {
  const trpc = useTRPC();
  const { folders } = useFolders();
  const [formTarget, setFormTarget] = useState<FormTarget | null>(null);

  const environmentQueries = useQueries({
    queries: folders.map((folder) =>
      trpc.environment.list.queryOptions(
        { repoPath: folder.path },
        { staleTime: 30_000 },
      ),
    ),
  });

  const projects = useMemo(() => {
    const result: ProjectEnvironments[] = [];

    for (let i = 0; i < folders.length; i++) {
      const folder = folders[i];
      const query = environmentQueries[i];

      result.push({
        folder,
        environments: query?.data ?? [],
        isLoading: query?.isLoading ?? true,
      });
    }

    return result.sort((a, b) => a.folder.name.localeCompare(b.folder.name));
  }, [folders, environmentQueries]);

  const context = useSettingsDialogStore((s) => s.context);
  const clearContext = useSettingsDialogStore((s) => s.clearContext);
  const setFormMode = useSettingsDialogStore((s) => s.setFormMode);

  useEffect(() => {
    if (!context.repoPath) return;
    const folder = folders.find((f) => f.path === context.repoPath);
    if (folder) {
      setFormTarget({ folder });
    }
    clearContext();
  }, [context.repoPath, folders, clearContext]);

  useEffect(() => {
    setFormMode(formTarget !== null);
    return () => setFormMode(false);
  }, [formTarget, setFormMode]);

  const handleCreate = useCallback((folder: RegisteredFolder) => {
    setFormTarget({ folder });
  }, []);

  const handleEdit = useCallback(
    (folder: RegisteredFolder, environment: Environment) => {
      setFormTarget({ folder, environment });
    },
    [],
  );

  const handleBack = useCallback(() => {
    setFormTarget(null);
  }, []);

  if (formTarget) {
    return (
      <EnvironmentForm
        key={formTarget.environment?.id ?? formTarget.folder.id}
        folder={formTarget.folder}
        environment={formTarget.environment}
        onBack={handleBack}
      />
    );
  }

  return (
    <Flex direction="column" gap="4">
      <Text color="gray" className="text-[13px]">
        A local environment is a setup recipe for one of your projects. When you
        start a task locally, the agent creates a fresh worktree and runs the
        recipe's setup script once — installing dependencies, running a build,
        or starting a dev server — so the agent begins in a project that's ready
        to work in. Stored as a TOML file inside each project; commit it and
        your teammates get the same setup. Pick one in the workspace picker when
        starting a task.
      </Text>
      <Text className="font-medium text-[13px]">Projects</Text>
      {projects.length === 0 ? (
        <Text color="gray" className="text-[13px]">
          No projects registered. Open a folder to get started.
        </Text>
      ) : (
        <Flex direction="column" gap="3">
          {projects.map((project) => (
            <ProjectEnvironmentCard
              key={project.folder.id}
              project={project}
              onCreate={handleCreate}
              onEdit={handleEdit}
            />
          ))}
        </Flex>
      )}
    </Flex>
  );
}
