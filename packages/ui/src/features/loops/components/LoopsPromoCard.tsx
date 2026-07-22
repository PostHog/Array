import {
  GitPullRequestIcon,
  type Icon,
  LifebuoyIcon,
  ListChecksIcon,
  SunIcon,
  TestTubeIcon,
  XIcon,
} from "@phosphor-icons/react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@posthog/quill";
import { LOOPS_FLAG } from "@posthog/shared";
import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import { loopHog } from "@posthog/ui/assets/hedgehogs";
import { useFeatureFlag } from "@posthog/ui/features/feature-flags/useFeatureFlag";
import { useLoopsPromoStore } from "@posthog/ui/features/loops/loopsPromoStore";
import { Button as UiButton } from "@posthog/ui/primitives/Button";
import { navigateToLoops } from "@posthog/ui/router/navigationBridge";
import { useAppView } from "@posthog/ui/router/useAppView";
import { track } from "@posthog/ui/shell/analytics";
import { Box } from "@radix-ui/themes";
import { useEffect, useState } from "react";

const EXAMPLES: { icon: Icon; label: string }[] = [
  {
    icon: GitPullRequestIcon,
    label: "Digest open pull requests and flag what needs attention",
  },
  {
    icon: TestTubeIcon,
    label: "Track down flaky tests and summarize CI failures",
  },
  {
    icon: ListChecksIcon,
    label: "Triage new issues and flag likely duplicates",
  },
  { icon: SunIcon, label: "Post a standup summary every weekday morning" },
  {
    icon: LifebuoyIcon,
    label: "Review support tickets and surface the urgent ones",
  },
];

export function LoopsPromoCard() {
  const loopsEnabled = useFeatureFlag(LOOPS_FLAG, import.meta.env.DEV);
  const dismissed = useLoopsPromoStore((state) => state.dismissed);
  const hasHydrated = useLoopsPromoStore((state) => state._hasHydrated);
  const dismiss = useLoopsPromoStore((state) => state.dismiss);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Reaching the Loops page on their own means the promo did its job (or was
  // never needed), so it retires the card the same way answering the dialog does.
  const view = useAppView();
  const onLoopsPage = view.type === "loops";
  useEffect(() => {
    if (onLoopsPage && hasHydrated && !dismissed) dismiss();
  }, [onLoopsPage, hasHydrated, dismissed, dismiss]);

  if (!loopsEnabled || !hasHydrated || (dismissed && !dialogOpen)) return null;

  const openDialog = () => {
    track(ANALYTICS_EVENTS.LOOPS_PROMO_OPENED);
    setDialogOpen(true);
  };

  const handleDismiss = () => {
    track(ANALYTICS_EVENTS.LOOPS_PROMO_DISMISSED);
    dismiss();
  };

  // Answering the dialog either way retires the card: it exists to get the
  // user into this dialog once, not to nag after they've decided.
  const handleNotNow = () => {
    track(ANALYTICS_EVENTS.LOOPS_PROMO_DISMISSED);
    setDialogOpen(false);
    dismiss();
  };

  const handleLearnMore = () => {
    track(ANALYTICS_EVENTS.LOOPS_PROMO_LEARN_MORE_CLICKED);
    setDialogOpen(false);
    dismiss();
    navigateToLoops();
  };

  return (
    <>
      {!dismissed && (
        <Box className="shrink-0 px-2 pb-2">
          <div className="group relative overflow-hidden rounded-md border border-gray-6 bg-gray-2">
            <button
              type="button"
              className="block w-full text-left transition-colors hover:bg-gray-3"
              onClick={openDialog}
            >
              <div className="flex h-24 items-center justify-center border-gray-6 border-b bg-gray-4">
                <img
                  src={loopHog}
                  alt=""
                  className="h-[72px] w-auto object-contain"
                />
              </div>
              <div className="flex flex-col gap-0.5 px-3 pt-3 pb-3">
                <span className="font-medium text-[13px] text-gray-12">
                  Introducing Loops
                </span>
                <span className="text-[11px] text-gray-11 leading-snug">
                  Recurring agent jobs that run in the cloud and report back.
                </span>
                {/* Rendered as a span: the whole card is already a button, and
                    nesting real buttons is invalid HTML. */}
                <UiButton
                  asChild
                  variant="outline"
                  color="gray"
                  size="1"
                  className="mt-2 self-start"
                >
                  <span>Learn more</span>
                </UiButton>
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
        </Box>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <div className="flex h-48 items-center justify-center border-gray-6 border-b bg-gray-4">
            <img src={loopHog} alt="" className="h-36 w-auto object-contain" />
          </div>
          <div className="flex flex-col gap-4 px-5 pt-4 pb-5">
            <div className="flex flex-col gap-1.5">
              <DialogTitle className="font-semibold text-[17px] text-gray-12 tracking-tight">
                Introducing Loops
              </DialogTitle>
              <DialogDescription className="text-[13px] text-gray-11 leading-relaxed">
                Describe a job once and it keeps running in the cloud, on a
                schedule or when something happens in your repos, even with your
                laptop closed. Every run reports back.
              </DialogDescription>
            </div>
            <div className="flex flex-col gap-2.5">
              <span className="font-medium text-[11px] text-gray-10 uppercase tracking-wide">
                Things to try
              </span>
              <ul className="flex flex-col gap-2">
                {EXAMPLES.map(({ icon: ExampleIcon, label }) => (
                  <li key={label} className="flex items-center gap-2.5">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-(--radius-2) bg-(--gray-a3) text-gray-11">
                      <ExampleIcon size={13} />
                    </span>
                    <span className="text-[13px] text-gray-11">{label}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={handleNotNow}>
                Not now
              </Button>
              <Button variant="primary" size="sm" onClick={handleLearnMore}>
                Try now
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
