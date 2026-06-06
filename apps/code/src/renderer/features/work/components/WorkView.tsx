import { useNavigationStore } from "@stores/navigationStore";
import { MemoryView } from "../../memory/components/MemoryView";
import { useProjectChatPrewarmer } from "../hooks/useProjectChatPrewarmer";
import { WorkDataSourcesView } from "./WorkDataSourcesView";
import { WorkGenerateView } from "./WorkGenerateView";
import { WorkHome } from "./WorkHome";
import { WorkProjectDetailView } from "./WorkProjectDetailView";
import { WorkProjectsView } from "./WorkProjectsView";
import { WorkSkillDetailView } from "./WorkSkillDetailView";
import { WorkSkillsView } from "./WorkSkillsView";
import { WorkTaskDetailView } from "./WorkTaskDetailView";

export function WorkView() {
  const workView = useNavigationStore((s) => s.workView);

  // Speculatively connect the top recent/pinned project chats so the
  // first interaction inside a project chat is instant.
  useProjectChatPrewarmer();

  if (workView === "generate") {
    return <WorkGenerateView />;
  }

  if (workView === "skill-detail") {
    return <WorkSkillDetailView />;
  }

  if (workView === "library") {
    return <WorkSkillsView />;
  }

  if (workView === "data-sources") {
    return <WorkDataSourcesView />;
  }

  if (workView === "memory") {
    return <MemoryView />;
  }

  if (workView === "projects") {
    return <WorkProjectsView />;
  }

  if (workView === "project-detail") {
    return <WorkProjectDetailView />;
  }

  if (workView === "task-detail") {
    return <WorkTaskDetailView />;
  }

  return <WorkHome />;
}
