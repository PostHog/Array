import {
  BugIcon,
  GitPullRequestIcon,
  type Icon,
  NotePencilIcon,
  TestTubeIcon,
  XIcon,
} from "@phosphor-icons/react";
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@posthog/quill";
import { LOOPS_FLAG } from "@posthog/shared";
import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import { loopHog } from "@posthog/ui/assets/hedgehogs";
import { useFeatureFlag } from "@posthog/ui/features/feature-flags/useFeatureFlag";
import { useLoopsPromoStore } from "@posthog/ui/features/loops/loopsPromoStore";
import { navigateToLoops } from "@posthog/ui/router/navigationBridge";
import { track } from "@posthog/ui/shell/analytics";
import { Box } from "@radix-ui/themes";
import { useState } from "react";

const EXAMPLES: { icon: Icon; label: string }[] = [
  {
    icon: GitPullRequestIcon,
    label: "Digest open pull requests and flag what needs attention",
  },
  {
    icon: TestTubeIcon,
    label: "Track down flaky tests and summarize CI failures",
  },
  { icon: BugIcon, label: "Triage new issues as they come in" },
  { icon: NotePencilIcon, label: "Draft release notes when a PR merges" },
];

export function LoopsPromoCard() {
  const loopsEnabled = useFeatureFlag(LOOPS_FLAG, import.meta.env.DEV);
  const dismissed = useLoopsPromoStore((state) => state.dismissed);
  const hasHydrated = useLoopsPromoStore((state) => state._hasHydrated);
  const dismiss = useLoopsPromoStore((state) => state.dismiss);
  const [dialogOpen, setDialogOpen] = useState(false);

  if (!loopsEnabled || !hasHydrated || dismissed) return null;

  const openDialog = () => {
    track(ANALYTICS_EVENTS.LOOPS_PROMO_OPENED);
    setDialogOpen(true);
  };

  const handleDismiss = () => {
    track(ANALYTICS_EVENTS.LOOPS_PROMO_DISMISSED);
    dismiss();
  };

  const handleLearnMore = () => {
    track(ANALYTICS_EVENTS.LOOPS_PROMO_LEARN_MORE_CLICKED);
    setDialogOpen(false);
    navigateToLoops();
  };

  return (
    <Box className="shrink-0 px-2 pb-2">
      <div className="group relative overflow-hidden rounded-md border border-gray-6 bg-gray-2">
        <button
          type="button"
          className="block w-full text-left transition-colors hover:bg-gray-3"
          onClick={openDialog}
        >
          <div className="flex h-20 items-end justify-center overflow-hidden bg-(--orange-a2)">
            <img
              src={loopHog}
              alt=""
              className="-mb-1.5 h-16 w-auto object-contain"
            />
          </div>
          <div className="flex flex-col gap-0.5 px-3 py-2.5">
            <span className="font-medium text-[13px] text-gray-12">
              Introducing Loops
            </span>
            <span className="text-[11px] text-gray-11 leading-snug">
              Recurring agent jobs that run in the cloud and report back.
            </span>
          </div>
        </button>
        <button
          type="button"
          aria-label="Dismiss Loops announcement"
          title="Dismiss"
          className="absolute top-1.5 right-1.5 rounded-full bg-(--gray-a3) p-1 text-gray-11 opacity-0 transition-all hover:bg-(--gray-a5) hover:text-gray-12 focus-visible:opacity-100 group-hover:opacity-100"
          onClick={handleDismiss}
        >
          <XIcon size={10} weight="bold" />
        </button>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <div className="flex h-40 items-end justify-center bg-(--orange-a2)">
            <img
              src={loopHog}
              alt=""
              className="-mb-2 h-32 w-auto object-contain"
            />
          </div>
          <DialogHeader>
            <DialogTitle>Introducing Loops</DialogTitle>
            <DialogDescription>
              Recurring jobs for your agent. Describe the work once and it keeps
              running in the cloud, even with your laptop closed.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-3 py-4">
            <p className="text-[13px] text-gray-12">
              A loop runs on a schedule or reacts to activity in your repos,
              then reports back after every run. Start from a template or
              describe your own:
            </p>
            <ul className="flex flex-col gap-2">
              {EXAMPLES.map(({ icon: ExampleIcon, label }) => (
                <li
                  key={label}
                  className="flex items-center gap-2.5 text-[13px] text-gray-11"
                >
                  <ExampleIcon size={15} className="shrink-0 text-gray-10" />
                  {label}
                </li>
              ))}
            </ul>
          </DialogBody>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDialogOpen(false)}
            >
              Not now
            </Button>
            <Button variant="primary" size="sm" onClick={handleLearnMore}>
              Learn more
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Box>
  );
}
