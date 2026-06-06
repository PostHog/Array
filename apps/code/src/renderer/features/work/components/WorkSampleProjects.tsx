import { useFolders } from "@features/folders/hooks/useFolders";
import {
  Bug,
  CalendarCheck,
  ChartLineUp,
  CurrencyDollar,
  Funnel,
  type IconProps,
  ListChecks,
  Megaphone,
  Microphone,
  Rocket,
  Sparkle,
  Target,
  TestTube,
  UsersThree,
} from "@phosphor-icons/react";
import { Box, Flex, Text } from "@radix-ui/themes";
import { get } from "@renderer/di/container";
import { RENDERER_TOKENS } from "@renderer/di/tokens";
import type {
  TaskCreationInput,
  TaskService,
} from "@renderer/features/task-detail/service/service";
import { trpcClient } from "@renderer/trpc/client";
import { toast } from "@renderer/utils/toast";
import type { ProjectIconId, WorkProject } from "@shared/types/work-projects";
import { useNavigationStore } from "@stores/navigationStore";
import { logger } from "@utils/logger";
import { type ComponentType, useMemo, useState } from "react";

const log = logger.scope("work-sample-projects");

type Category =
  | "general"
  | "growth"
  | "product"
  | "sales"
  | "engineering"
  | "research";

interface SampleProject {
  icon: ComponentType<IconProps>;
  title: string;
  description: string;
  prompt: string;
  tags: Category[];
}

const POOL: SampleProject[] = [
  {
    icon: CalendarCheck,
    title: "Weekly status",
    description: "What you shipped, what's next, what's stuck",
    prompt:
      "Draft my weekly status update – what I shipped, what's next, what I'm stuck on.",
    tags: ["general"],
  },
  {
    icon: ListChecks,
    title: "Today's plan",
    description: "Top 3 things to focus on today",
    prompt:
      "Help me plan today – what are the top 3 things I should focus on and why?",
    tags: ["general"],
  },
  {
    icon: Megaphone,
    title: "Campaign performance",
    description: "Which channels are converting this week",
    prompt:
      "Summarize this week's marketing campaign performance and what's actually converting.",
    tags: ["growth"],
  },
  {
    icon: Funnel,
    title: "Funnel diagnosis",
    description: "Where users are dropping off",
    prompt:
      "Diagnose where users are dropping off in our acquisition funnel this week.",
    tags: ["growth"],
  },
  {
    icon: ChartLineUp,
    title: "Feature adoption",
    description: "Which new features are sticking",
    prompt:
      "Which recently shipped features are users actually adopting, and which are flat?",
    tags: ["product"],
  },
  {
    icon: TestTube,
    title: "Experiment recap",
    description: "Which experiments concluded recently",
    prompt:
      "Summarize the experiments that concluded this week and their outcomes.",
    tags: ["product"],
  },
  {
    icon: Sparkle,
    title: "Onboarding drop-off",
    description: "Where new users are getting stuck",
    prompt:
      "Find where new users are dropping off in onboarding and propose one fix.",
    tags: ["product"],
  },
  {
    icon: CurrencyDollar,
    title: "Pipeline brief",
    description: "Top deals, risk, and momentum",
    prompt:
      "Pull together this week's pipeline brief – top deals, risk signals, and where momentum is shifting.",
    tags: ["sales"],
  },
  {
    icon: Target,
    title: "Deals at risk",
    description: "Which late-stage deals look shaky",
    prompt: "Which late-stage opportunities look at risk this week and why?",
    tags: ["sales"],
  },
  {
    icon: Rocket,
    title: "Release notes",
    description: "What shipped this week, in plain English",
    prompt: "Draft this week's release notes from merged PRs in plain English.",
    tags: ["engineering"],
  },
  {
    icon: Bug,
    title: "Top errors",
    description: "Worst regressions in the last 7 days",
    prompt:
      "What are the top errors and regressions in the last 7 days, ranked by impact?",
    tags: ["engineering"],
  },
  {
    icon: Microphone,
    title: "User interviews",
    description: "Themes from recent customer calls",
    prompt:
      "Summarize themes from recent user interviews and call out the most actionable insight.",
    tags: ["research"],
  },
  {
    icon: UsersThree,
    title: "Power users to talk to",
    description: "Pick the next 3 to interview",
    prompt:
      "Identify the top 3 power users I should interview this week and why.",
    tags: ["research"],
  },
];

const ICON_CATEGORIES: Record<ProjectIconId, Category[]> = {
  rocket: ["engineering", "growth"],
  microphone: ["research"],
  megaphone: ["growth"],
  lightbulb: ["product"],
  compass: ["research", "general"],
  target: ["sales"],
  flask: ["product"],
  lightning: ["engineering"],
  sparkle: ["product"],
  globe: ["growth"],
};

const KEYWORD_CATEGORIES: { pattern: RegExp; category: Category }[] = [
  {
    pattern: /\b(campaign|marketing|acquisition|channel|seo|ads?)\b/i,
    category: "growth",
  },
  {
    pattern: /\b(funnel|conversion|signup|sign-up|activation|onboarding)\b/i,
    category: "growth",
  },
  {
    pattern: /\b(feature|adoption|experiment|a\/b|test|product)\b/i,
    category: "product",
  },
  {
    pattern: /\b(deal|pipeline|revenue|sales|account|customer|renewal)\b/i,
    category: "sales",
  },
  {
    pattern: /\b(ship|release|deploy|pr|bug|error|incident|engineering)\b/i,
    category: "engineering",
  },
  {
    pattern: /\b(interview|research|feedback|user|persona|power)\b/i,
    category: "research",
  },
];

function inferCategories(project: WorkProject): Set<Category> {
  const tags = new Set<Category>();
  for (const c of ICON_CATEGORIES[project.iconId] ?? []) tags.add(c);
  const text = `${project.name} ${project.tagline}`;
  for (const { pattern, category } of KEYWORD_CATEGORIES) {
    if (pattern.test(text)) tags.add(category);
  }
  return tags;
}

function pickPersonalized(
  projects: WorkProject[],
  count: number,
): SampleProject[] {
  const scoreByCategory = new Map<Category, number>();
  for (const project of projects) {
    for (const c of inferCategories(project)) {
      scoreByCategory.set(c, (scoreByCategory.get(c) ?? 0) + 1);
    }
  }

  // Score each pool item by total category overlap with project signal,
  // plus a tiny baseline for "general" so we keep a weekly-status-style
  // fallback in the mix when signal is sparse.
  const scored = POOL.map((item, idx) => {
    let score = 0;
    for (const tag of item.tags) {
      score += scoreByCategory.get(tag) ?? 0;
      if (tag === "general") score += 0.5;
    }
    return { item, score, idx };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.idx - b.idx; // stable fallback on pool order
  });

  // De-dupe by category so we don't return 4 sales prompts when every
  // project is sales-flavored — variety reads as more useful than depth.
  const picked: SampleProject[] = [];
  const usedPrimary = new Set<Category>();
  for (const { item } of scored) {
    const primary = item.tags[0];
    if (usedPrimary.has(primary)) continue;
    picked.push(item);
    usedPrimary.add(primary);
    if (picked.length === count) break;
  }
  // If category-dedupe left us short (very narrow pool / lots of projects),
  // top up from the remaining scored list ignoring the dedupe.
  if (picked.length < count) {
    for (const { item } of scored) {
      if (picked.includes(item)) continue;
      picked.push(item);
      if (picked.length === count) break;
    }
  }
  return picked;
}

async function resolveRepoPath(folders: string[]): Promise<string> {
  if (folders.length > 0) return folders[0];
  return trpcClient.os.getHomeDir.query();
}

function SampleCard({
  project,
  onCreate,
  disabled,
}: {
  project: SampleProject;
  onCreate: (prompt: string) => void;
  disabled: boolean;
}) {
  const Icon = project.icon;
  return (
    <button
      type="button"
      onClick={() => onCreate(project.prompt)}
      disabled={disabled}
      className="flex flex-1 flex-col items-start gap-1 rounded-(--radius-3) border border-(--gray-5) bg-(--gray-1) p-3 text-left transition-colors hover:border-(--gray-7) hover:bg-(--gray-2) disabled:cursor-not-allowed disabled:opacity-60"
    >
      <Box className="text-(--gray-11)">
        <Icon size={20} weight="duotone" />
      </Box>
      <Text as="div" weight="medium" className="text-(--gray-12) text-[13px]">
        {project.title}
      </Text>
      <Text as="div" className="text-(--gray-11) text-[12px]">
        {project.description}
      </Text>
    </button>
  );
}

export function WorkSampleProjects({ projects }: { projects: WorkProject[] }) {
  const navigateToWorkTask = useNavigationStore((s) => s.navigateToWorkTask);
  const { folders, isLoaded: foldersLoaded } = useFolders();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const picked = useMemo(() => pickPersonalized(projects, 4), [projects]);

  const handleCreate = async (prompt: string) => {
    if (isSubmitting || !foldersLoaded) return;

    setIsSubmitting(true);
    try {
      const folderPaths = folders.map((f) => f.path);
      const repoPath = await resolveRepoPath(folderPaths);

      const input: TaskCreationInput = {
        content: prompt,
        repoPath,
        workspaceMode: "local",
      };

      const taskService = get<TaskService>(RENDERER_TOKENS.TaskService);
      const result = await taskService.createTask(input, (output) => {
        navigateToWorkTask(output.task.id);
      });

      if (!result.success) {
        toast.error("Failed to start task", { description: result.error });
        log.error("Sample project task creation failed", {
          failedStep: result.failedStep,
          error: result.error,
        });
      }
    } catch (error) {
      const description =
        error instanceof Error ? error.message : "Unknown error";
      toast.error("Failed to start task", { description });
      log.error("Unexpected error during sample project creation", { error });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Box className="w-full">
      <Text
        as="div"
        weight="medium"
        className="mb-2 text-(--gray-12) text-[13px]"
      >
        Quick tasks
      </Text>
      <Flex gap="2" className="w-full">
        {picked.map((p) => (
          <SampleCard
            key={p.title}
            project={p}
            onCreate={handleCreate}
            disabled={isSubmitting}
          />
        ))}
      </Flex>
    </Box>
  );
}
