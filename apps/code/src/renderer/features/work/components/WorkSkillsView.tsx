import {
  ArrowSquareOut,
  Hash,
  type IconProps,
  Lightbulb,
  Plus,
  X,
} from "@phosphor-icons/react";
import { Box, Dialog, Flex, SegmentedControl, Text } from "@radix-ui/themes";
import { useNavigationStore } from "@stores/navigationStore";
import { useWorkSkillsStore } from "@stores/workSkillsStore";
import { openUrlInBrowser } from "@utils/browser";
import { type ComponentType, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { type CatalogSkill, getUserCatalog } from "../data/skillsCatalog";
import {
  AXIS_LABEL,
  AXIS_ORDER,
  computeStarMap,
  type StarAxis,
  type StarMapScores,
} from "../utils/computeStarMap";
import { SkillsStarMap, SkillsStarMapMini } from "./SkillsStarMap";

const TEAM_SKILLS_LIBRARY_URL =
  "https://app.posthog.com/project/2/llm-analytics/skills";

const EXTERNAL_SKILLS_SEARCH_URL = "https://skills.sh";

type SkillScope = "user" | "team";

type SkillTag = "product" | "growth" | "sales" | "customer" | "reporting";

type TagFilter = SkillTag | "all";

const TAG_META: Record<SkillTag, { label: string }> = {
  product: { label: "Product" },
  growth: { label: "Growth" },
  sales: { label: "Sales" },
  customer: { label: "Customer" },
  reporting: { label: "Reporting" },
};

const TAG_ORDER: SkillTag[] = [
  "product",
  "growth",
  "sales",
  "customer",
  "reporting",
];

function TagFilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-[12px] transition-colors ${
        active
          ? "border-(--gray-12) bg-(--gray-12) text-(--gray-1)"
          : "border-(--gray-5) bg-(--gray-1) text-(--gray-11) hover:border-(--gray-7) hover:text-(--gray-12)"
      }`}
    >
      {label}
    </button>
  );
}

interface SkillCardProps {
  icon: ComponentType<IconProps>;
  title: string;
  description: string;
  isActive: boolean;
  onToggle?: () => void;
  onOpen?: () => void;
}

function SkillCard({
  icon: Icon,
  title,
  description,
  isActive,
  onToggle,
  onOpen,
}: SkillCardProps) {
  const interactive = !!onOpen;
  return (
    <Flex
      align="center"
      gap="3"
      className={`rounded-(--radius-3) border border-(--gray-5) bg-(--gray-1) p-3 transition-colors ${
        interactive
          ? "cursor-pointer hover:border-(--gray-7) hover:bg-(--gray-2)"
          : ""
      }`}
      onClick={onOpen}
    >
      <Box className="text-(--gray-11)">
        <Icon size={20} weight="duotone" />
      </Box>
      <Box className="min-w-0 flex-1">
        <Text as="div" weight="medium" className="text-(--gray-12) text-[13px]">
          {title}
        </Text>
        <Text as="div" className="text-(--gray-11) text-[12px]">
          {description}
        </Text>
      </Box>
      <button
        type="button"
        disabled={!onToggle}
        onClick={(e) => {
          e.stopPropagation();
          onToggle?.();
        }}
        className={`flex shrink-0 items-center gap-1 rounded-(--radius-2) border border-(--gray-5) px-2 py-1 font-medium text-[12px] transition-colors ${
          onToggle
            ? "hover:border-(--gray-7) hover:bg-(--gray-2)"
            : "opacity-60"
        } ${isActive ? "text-(--gray-11)" : "text-(--gray-12)"}`}
      >
        {isActive ? (
          <>
            <X size={12} weight="bold" />
            Disable
          </>
        ) : (
          <>
            <Plus size={12} weight="bold" />
            Add
          </>
        )}
      </button>
    </Flex>
  );
}

function SkillSection({
  label,
  hint,
  count,
  emptyMessage,
  action,
  children,
}: {
  label: string;
  hint: string;
  count: number;
  emptyMessage: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Box className="w-full">
      <Flex align="center" justify="between" gap="2" className="mb-2">
        <Flex align="baseline" gap="2">
          <Text
            as="span"
            weight="medium"
            className="text-(--gray-12) text-[13px]"
          >
            {label}
          </Text>
          <Text as="span" className="text-(--gray-10) text-[12px]">
            {count}
          </Text>
        </Flex>
        {action}
      </Flex>
      <Text as="div" className="mb-3 text-(--gray-11) text-[12px]">
        {hint}
      </Text>
      {count === 0 ? (
        <Box className="rounded-(--radius-3) border border-(--gray-5) border-dashed bg-(--gray-1) p-4 text-center text-(--gray-10) text-[12px]">
          {emptyMessage}
        </Box>
      ) : (
        <Flex direction="column" gap="2">
          {children}
        </Flex>
      )}
    </Box>
  );
}

const HOUR_MS = 60 * 60 * 1000;

function newSkillId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `skill-${Date.now()}`;
}

type FounderTier = "none" | "light" | "strong" | "heavy";

function founderTier(score: number): FounderTier {
  if (score <= 0) return "none";
  if (score < 2) return "light";
  if (score < 4) return "strong";
  return "heavy";
}

const FOUNDER_TIER_LABEL: Record<FounderTier, string> = {
  none: "no founder energy",
  light: "founder-curious",
  strong: "founder energy",
  heavy: "full founder mode",
};

function topTwoAxes(
  scores: StarMapScores,
): { top: StarAxis; second: StarAxis | null; tied: boolean } | null {
  if (scores.max === 0) return null;
  const sorted = AXIS_ORDER.map((axis) => ({
    axis,
    value: scores.axes[axis],
  })).sort((a, b) => b.value - a.value);
  const top = sorted[0];
  if (top.value <= 0) return null;
  const second = sorted[1];
  const tied = !!second && second.value === top.value;
  return { top: top.axis, second: second?.axis ?? null, tied };
}

const AXIS_HEADLINE: Record<StarAxis, string> = {
  marketing: "Built different for launch day",
  operations: "The reason anything ships at all",
  product: "Roadmap whisperer",
  design: "Pixels have feelings, and you know them",
  hr: "The team's emotional support adult",
  finance: "Spreadsheet brain, unlocked",
  legal: "Sleeps next to the DPA",
};

const AXIS_DESCRIPTION: Record<StarAxis, Record<FounderTier, string>> = {
  marketing: {
    none: "You can ship a campaign in your sleep — ask you to forecast next quarter and the room goes quiet.",
    light:
      "Launch days are your Olympics. Cap-table conversations are someone else's sport, but you're starting to peek.",
    strong:
      "Comms brain wired to roadmap brain. You ship the post *and* know what it costs to ship it.",
    heavy:
      "Marketing *and* cap table? You're either a founder or pretending convincingly. Both count.",
  },
  operations: {
    none: "You keep the trains running. The board deck is somebody else's problem, and that's fine for now.",
    light:
      "Process gods love you. Pricing decks still feel like a foreign language — but only just.",
    strong:
      "You run the machine *and* know which lever does what. Dangerous in a good way.",
    heavy:
      "Ops, automation, *and* the strategy memo. The company quietly runs on you. Take a vacation.",
  },
  product: {
    none: "PRDs flow out of you. Numbers on the pricing page are someone else's department.",
    light:
      "Discovery, specs, roadmap — locked in. The P&L is starting to make sense, ask again in a quarter.",
    strong:
      "Roadmap, discovery, *and* you can read a P&L. The dangerous kind of PM.",
    heavy:
      "PM by title, founder by behaviour. Stop calling yourself a PM, it's getting weird.",
  },
  design: {
    none: "You sweat the kerning. You delegate the spreadsheet, and the spreadsheet is fine with that.",
    light:
      "Pixels are pristine. Pricing tiers are starting to look like a design problem to you — that's the right instinct.",
    strong: "You sweat the kerning *and* the pricing page. Rare combo.",
    heavy:
      "Design lead with founder reflexes. Cofounder material. Send your designer friend this quiz immediately.",
  },
  hr: {
    none: "You make people feel seen. Asking for the raise — different story.",
    light:
      "Team's emotional core. Starting to think about comp bands, which is a healthy sign.",
    strong:
      "1:1s *and* hiring plans *and* a view on burn. You're running People, not just doing it.",
    heavy:
      "Chief of staff energy with founder reflexes. Whoever you work for is extremely lucky.",
  },
  finance: {
    none: "Revenue, billing, pricing — your turf. Now find someone to handle everything else.",
    light:
      "Numbers brain. Slowly accumulating the broader operator instincts. Keep going.",
    strong:
      "Finance lead with strategy chops. You make the spreadsheet *and* the call.",
    heavy:
      "Pricing, billing, *and* delegate-the-rest energy. Hire a designer immediately.",
  },
  legal: {
    none: "DPAs hold no fear. Revenue still does.",
    light: "Contracts are a solved problem. Cap table is the next mountain.",
    strong:
      "Legal brain *and* commercial brain. Every founder wants you on speed-dial.",
    heavy:
      "Counsel, commercial, *and* founder instincts. You should probably be running something.",
  },
};

const EMPTY_HEADLINE = "Add some skills to chart your map";
const EMPTY_DESCRIPTION =
  "No skills active yet. Add a few and we'll roast your shape.";

function balancedHeadline(top: StarAxis, second: StarAxis): string {
  return `Quietly doing both ${AXIS_LABEL[top]} and ${AXIS_LABEL[second]}`;
}

const BALANCED_DESCRIPTION =
  "Two roles tied at the top. Either you're suspiciously well-rounded or your skills need sharper edges.";

function starMapTagline(scores: StarMapScores): string {
  const top = topTwoAxes(scores);
  if (!top) return EMPTY_HEADLINE;
  if (top.tied && top.second) return balancedHeadline(top.top, top.second);
  return AXIS_HEADLINE[top.top];
}

function starMapDescription(scores: StarMapScores): string {
  const top = topTwoAxes(scores);
  if (!top) return EMPTY_DESCRIPTION;
  if (top.tied) return BALANCED_DESCRIPTION;
  return AXIS_DESCRIPTION[top.top][founderTier(scores.founder)];
}

function emojiBar(value: number, max: number, width = 8): string {
  if (max <= 0) return "░".repeat(width);
  const filled = Math.max(
    0,
    Math.min(width, Math.round((value / max) * width)),
  );
  return "▓".repeat(filled) + "░".repeat(width - filled);
}

function formatStarMapForSlack(scores: StarMapScores): string {
  const headline = starMapTagline(scores);
  const description = starMapDescription(scores);
  const founder = Math.round(scores.founder * 10) / 10;
  const tierLabel = FOUNDER_TIER_LABEL[founderTier(scores.founder)];
  const labelWidth = Math.max(...AXIS_ORDER.map((a) => AXIS_LABEL[a].length));
  const rows = AXIS_ORDER.map((axis) => {
    const label = AXIS_LABEL[axis].padEnd(labelWidth, " ");
    const bar = emojiBar(scores.axes[axis], scores.max);
    return `${label}  ${bar}  ${scores.axes[axis]}`;
  }).join("\n");
  return [
    `🦔 *${headline}* — Founder score *${founder}* (${tierLabel})`,
    "",
    "```",
    rows,
    "```",
    `_${description}_`,
    "> Charted by PostHog Code · posthog.com/code",
  ].join("\n");
}

async function copyStarMapToSlack(scores: StarMapScores): Promise<void> {
  const text = formatStarMapForSlack(scores);
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Copied for Slack — paste it into any channel");
  } catch {
    toast.error("Couldn't copy to clipboard");
  }
}

export function WorkSkillsView() {
  const [scope, setScope] = useState<SkillScope>("user");
  const [tagFilter, setTagFilter] = useState<TagFilter>("all");
  const [lastComputedAt, setLastComputedAt] = useState(() => Date.now());
  const [starMapOpen, setStarMapOpen] = useState(false);
  const setMode = useNavigationStore((s) => s.setMode);
  const navigateToSkills = useNavigationStore((s) => s.navigateToSkills);
  const navigateToWorkSkill = useNavigationStore((s) => s.navigateToWorkSkill);
  const navigateToWorkGenerate = useNavigationStore(
    (s) => s.navigateToWorkGenerate,
  );

  const workSkills = useWorkSkillsStore((s) => s.skills);
  const addSkill = useWorkSkillsStore((s) => s.addSkill);
  const deleteSkill = useWorkSkillsStore((s) => s.deleteSkill);

  const userCatalog = useMemo(() => getUserCatalog(), []);

  // Seed defaults on first hydration only. Each defaultActive catalog entry
  // is auto-added once and recorded in seededCatalogIds; after that the user's
  // disable persists across navigations and restarts.
  // biome-ignore lint/correctness/useExhaustiveDependencies: seed pulls fresh store state at mount.
  useEffect(() => {
    const state = useWorkSkillsStore.getState();
    for (const catalog of userCatalog) {
      if (!catalog.defaultActive) continue;
      if (state.seededCatalogIds.includes(catalog.id)) continue;
      if (!state.skills.some((s) => s.catalogId === catalog.id)) {
        state.addSkill({
          id: newSkillId(),
          name: catalog.title,
          prompt: catalog.prompt,
          catalogId: catalog.id,
        });
      }
      state.markSeeded(catalog.id);
    }
  }, [userCatalog]);

  const activeWorkSkillByCatalogId = useMemo(() => {
    const map = new Map<string, (typeof workSkills)[number]>();
    for (const s of workSkills) {
      if (s.catalogId) map.set(s.catalogId, s);
    }
    return map;
  }, [workSkills]);

  const matchesTag = (s: { tags: SkillTag[] }) =>
    tagFilter === "all" || s.tags.includes(tagFilter);

  const userActive = userCatalog.filter(
    (c) => activeWorkSkillByCatalogId.has(c.id) && matchesTag(c),
  );
  const userLibrary = userCatalog.filter(
    (c) => !activeWorkSkillByCatalogId.has(c.id) && matchesTag(c),
  );

  const handleAddCatalog = (catalog: CatalogSkill) => {
    const id = newSkillId();
    addSkill({
      id,
      name: catalog.title,
      prompt: catalog.prompt,
      catalogId: catalog.id,
    });
    navigateToWorkSkill(id);
  };

  const handleDisableCatalog = (catalogId: string) => {
    const existing = activeWorkSkillByCatalogId.get(catalogId);
    if (existing) deleteSkill(existing.id);
  };

  const handleOpenCatalog = (catalogId: string) => {
    const existing = activeWorkSkillByCatalogId.get(catalogId);
    if (existing) navigateToWorkSkill(existing.id);
  };

  const handleOpenCodeSkills = () => {
    setMode("code");
    navigateToSkills();
  };

  useEffect(() => {
    const id = setInterval(() => setLastComputedAt(Date.now()), HOUR_MS);
    return () => clearInterval(id);
  }, []);

  // Star map reflects the user's currently-active catalog skills so it shifts
  // as they toggle. When nothing is active, show the whole catalog so the
  // visualization stays populated.
  const starScores = useMemo(() => {
    const source = userActive.length > 0 ? userActive : userCatalog;
    return computeStarMap(
      source.map((s) => ({
        title: s.title,
        description: s.description,
        tags: s.tags,
      })),
    );
  }, [userActive, userCatalog]);

  return (
    <Box className="scrollbar-overlay-y h-full w-full overflow-y-auto">
      <Flex
        direction="column"
        gap="5"
        className="mx-auto w-full max-w-[760px] px-6 pt-10 pb-12"
      >
        <Flex direction="column" gap="2">
          <Flex align="center" gap="2">
            <Lightbulb
              size={20}
              weight="duotone"
              className="text-(--gray-11)"
            />
            <Text
              as="div"
              weight="medium"
              className="text-(--gray-12) text-[20px]"
            >
              Skills
            </Text>
          </Flex>
          <Text as="div" className="text-(--gray-11) text-[13px]">
            Reusable workflows PostHog Work runs for you. Activate the ones you
            want and add new ones from the library.
          </Text>
        </Flex>

        <Flex align="center" justify="between" gap="3" wrap="wrap">
          <SegmentedControl.Root
            value={scope}
            onValueChange={(v) => setScope(v as SkillScope)}
            size="2"
          >
            <SegmentedControl.Item value="user">
              Your skills
            </SegmentedControl.Item>
            <SegmentedControl.Item value="team">
              Team skills
            </SegmentedControl.Item>
          </SegmentedControl.Root>

          <Flex align="center" gap="2">
            <button
              type="button"
              onClick={navigateToWorkGenerate}
              className="flex items-center gap-1 rounded-(--radius-2) border border-(--accent-7) bg-(--accent-3) px-2.5 py-1 text-(--accent-11) text-[12px] transition-colors hover:border-(--accent-8) hover:bg-(--accent-4)"
            >
              <Plus size={12} weight="bold" />
              New skill
            </button>
            {scope === "team" && (
              <button
                type="button"
                onClick={() => openUrlInBrowser(TEAM_SKILLS_LIBRARY_URL)}
                title="Open the team skills library in PostHog Cloud"
                className="flex items-center gap-1 rounded-(--radius-2) border border-(--gray-5) bg-(--gray-1) px-2.5 py-1 text-(--gray-11) text-[12px] transition-colors hover:border-(--gray-7) hover:bg-(--gray-2) hover:text-(--gray-12)"
              >
                Manage in PostHog
                <ArrowSquareOut size={12} weight="bold" />
              </button>
            )}
          </Flex>
        </Flex>

        {scope === "user" && (
          <button
            type="button"
            onClick={() => setStarMapOpen(true)}
            className="flex items-center gap-3 rounded-(--radius-3) border border-(--gray-5) bg-(--gray-1) p-2.5 text-left transition-colors hover:border-(--gray-7) hover:bg-(--gray-2)"
          >
            <Box className="shrink-0 rounded-(--radius-2) border border-(--gray-5) bg-(--gray-2) p-1.5">
              <SkillsStarMapMini scores={starScores} size={40} />
            </Box>
            <Box className="min-w-0 flex-1">
              <Text
                as="div"
                className="text-(--gray-10) text-[11px] uppercase tracking-wide"
              >
                Your star map
              </Text>
              <Flex align="baseline" gap="2" wrap="wrap">
                <Text
                  as="span"
                  weight="medium"
                  className="text-(--gray-12) text-[14px]"
                >
                  {starMapTagline(starScores)}
                </Text>
                <Text as="span" className="text-(--gray-11) text-[12px] italic">
                  Founder {Math.round(starScores.founder * 10) / 10}
                </Text>
              </Flex>
            </Box>
            <Text
              as="span"
              className="shrink-0 text-(--gray-10) text-[12px] underline-offset-2"
            >
              See chart
            </Text>
          </button>
        )}

        {scope === "user" && (
          <Flex align="center" gap="2" wrap="wrap">
            <TagFilterChip
              label="All"
              active={tagFilter === "all"}
              onClick={() => setTagFilter("all")}
            />
            {TAG_ORDER.map((t) => (
              <TagFilterChip
                key={t}
                label={TAG_META[t].label}
                active={tagFilter === t}
                onClick={() => setTagFilter(t)}
              />
            ))}
          </Flex>
        )}

        {scope === "user" ? (
          <>
            <SkillSection
              label="Active"
              hint="Click to open and run on demand."
              count={userActive.length}
              emptyMessage="No active skills yet — add one from the library below."
            >
              {userActive.map((c) => (
                <SkillCard
                  key={c.id}
                  icon={c.icon}
                  title={c.title}
                  description={c.description}
                  isActive
                  onToggle={() => handleDisableCatalog(c.id)}
                  onOpen={() => handleOpenCatalog(c.id)}
                />
              ))}
            </SkillSection>

            <SkillSection
              label="Library"
              hint="Available skills you haven't activated yet."
              count={userLibrary.length}
              emptyMessage="No skills match this tag."
              action={
                <button
                  type="button"
                  onClick={() => openUrlInBrowser(EXTERNAL_SKILLS_SEARCH_URL)}
                  title="Browse community skill libraries like skills.sh"
                  className="flex items-center gap-1 rounded-(--radius-2) border border-(--gray-5) bg-(--gray-1) px-2 py-1 text-(--gray-11) text-[12px] transition-colors hover:border-(--gray-7) hover:bg-(--gray-2) hover:text-(--gray-12)"
                >
                  Search skills.sh
                  <ArrowSquareOut size={12} weight="bold" />
                </button>
              }
            >
              {userLibrary.map((c) => (
                <SkillCard
                  key={c.id}
                  icon={c.icon}
                  title={c.title}
                  description={c.description}
                  isActive={false}
                  onToggle={() => handleAddCatalog(c)}
                />
              ))}
            </SkillSection>
          </>
        ) : (
          <Box className="rounded-(--radius-3) border border-(--gray-5) border-dashed bg-(--gray-1) p-6 text-center">
            <Text
              as="div"
              weight="medium"
              className="text-(--gray-12) text-[14px]"
            >
              Team skills live in PostHog Cloud
            </Text>
            <Text
              as="div"
              className="mx-auto mt-1 max-w-[420px] text-(--gray-11) text-[13px]"
            >
              Skills your team shares are created and scheduled in PostHog. Open
              the library to view and manage them.
            </Text>
            <Flex justify="center" className="mt-3">
              <button
                type="button"
                onClick={() => openUrlInBrowser(TEAM_SKILLS_LIBRARY_URL)}
                className="flex items-center gap-1 rounded-(--radius-2) border border-(--gray-5) bg-(--gray-1) px-2.5 py-1 text-(--gray-11) text-[12px] transition-colors hover:border-(--gray-7) hover:bg-(--gray-2) hover:text-(--gray-12)"
              >
                Manage in PostHog
                <ArrowSquareOut size={12} weight="bold" />
              </button>
            </Flex>
          </Box>
        )}

        <Box className="mt-2 border-(--gray-5) border-t pt-4">
          <button
            type="button"
            onClick={handleOpenCodeSkills}
            className="text-(--gray-10) text-[12px] underline-offset-2 transition-colors hover:text-(--gray-11) hover:underline"
          >
            Looking for coding skills? Manage them in PostHog Code → Skills.
          </button>
        </Box>
      </Flex>

      <Dialog.Root open={starMapOpen} onOpenChange={setStarMapOpen}>
        <Dialog.Content maxWidth="560px" size="3" className="relative">
          <button
            type="button"
            onClick={() => setStarMapOpen(false)}
            aria-label="Close"
            title="Close"
            className="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-(--radius-2) text-(--gray-10) transition-colors hover:bg-(--gray-3) hover:text-(--gray-12)"
          >
            <X size={14} weight="bold" />
          </button>
          <Flex direction="column" align="center" gap="3" className="py-2">
            <Flex direction="column" align="center" gap="1">
              <Text
                as="div"
                className="text-(--gray-10) text-[11px] uppercase tracking-wide"
              >
                Your star map
              </Text>
              <Text
                as="div"
                weight="medium"
                className="text-(--gray-12) text-[20px]"
              >
                {starMapTagline(starScores)}
              </Text>
            </Flex>
            <Text
              as="div"
              className="mx-auto max-w-[440px] text-center text-(--gray-11) text-[13px] leading-snug"
            >
              {starMapDescription(starScores)}
            </Text>
            <Box className="mt-1 w-full">
              <SkillsStarMap
                scores={starScores}
                lastComputedAt={lastComputedAt}
              />
            </Box>
            <Flex align="center" justify="center" gap="2" className="mt-1">
              <button
                type="button"
                onClick={() => copyStarMapToSlack(starScores)}
                className="flex items-center gap-1.5 rounded-(--radius-2) border border-(--gray-5) bg-(--gray-1) px-3 py-1 font-medium text-(--gray-12) text-[12px] transition-colors hover:border-(--gray-7) hover:bg-(--gray-2)"
              >
                <Hash size={12} weight="bold" />
                Copy for Slack
              </button>
            </Flex>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
    </Box>
  );
}
