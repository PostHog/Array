import { FolderSettingsView } from "@features/settings/components/FolderSettingsView";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/folders/$folderId")({
  component: FolderSettingsView,
});
