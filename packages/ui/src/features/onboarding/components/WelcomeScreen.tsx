import {
  ArrowRight,
  ChartLine,
  Cloud,
  GitPullRequest,
  Robot,
  Tray,
} from "@phosphor-icons/react";
import { explorerHog } from "@posthog/ui/assets/hedgehogs";
import { FeatureBentoCard } from "@posthog/ui/features/onboarding/components/FeatureBentoCard";
import { StepActions } from "@posthog/ui/features/onboarding/components/StepActions";
import Logo from "@posthog/ui/primitives/Logo";
import { OnboardingHogTip } from "@posthog/ui/primitives/OnboardingHogTip";
import { Button, Flex, Text } from "@radix-ui/themes";
import { useCallback, useEffect, useRef, useState } from "react";

const FEATURES = [
  {
    icon: <ChartLine size={28} />,
    title: "Product data as context",
    description:
      "Built-in context on analytics, session replays, experiments, feature flags, and more.",
    className: "col-span-4",
  },
  {
    icon: <Tray size={26} />,
    title: "Your signals inbox",
    description:
      "Automatically surfaces the highest-impact work from your product data so you always know what to do next.",
    className: "col-span-2",
  },
  {
    icon: <Robot size={22} />,
    title: "Your pick of Claude Code or Codex",
    description:
      "PostHog is harness-agnostic – both Anthropic and OpenAI supported.",
    className: "col-span-2",
  },
  {
    icon: <Cloud size={22} />,
    title: "Build non-stop",
    description:
      "Run tasks in parallel across local and cloud environments - even while you're away.",
    className: "col-span-2",
  },
  {
    icon: <GitPullRequest size={22} />,
    title: "Review and ship with confidence",
    description:
      "Inline diffs, AI-assisted code review and PR creation in a single flow.",
    className: "col-span-2",
  },
];

interface WelcomeScreenProps {
  onNext: () => void;
}

const CYCLE_INTERVAL_MS = 2500;
const CYCLE_START_DELAY_MS = FEATURES.length * 100 + 400;

export function WelcomeScreen({ onNext }: WelcomeScreenProps) {
  const [activeIndex, setActiveIndex] = useState(-1);
  const timerRef = useRef<ReturnType<typeof setInterval>>(null);

  const startCycling = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % FEATURES.length);
    }, CYCLE_INTERVAL_MS);
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setActiveIndex(0);
      startCycling();
    }, CYCLE_START_DELAY_MS);

    return () => {
      clearTimeout(timeout);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [startCycling]);

  const handleMouseEnter = (index: number) => {
    setActiveIndex(index);
    if (timerRef.current) clearInterval(timerRef.current);
  };

  const handleMouseLeave = () => {
    startCycling();
  };

  return (
    <Flex align="center" height="100%" px="8">
      <Flex
        direction="column"
        align="center"
        className="h-full w-full pt-[24px] pb-[40px]"
      >
        <Flex
          direction="column"
          align="center"
          className="min-h-0 w-full flex-1"
        >
          <Flex
            direction="column"
            align="start"
            className="mx-0 my-auto w-full max-w-[760px] gap-6 overflow-hidden"
          >
            <Flex direction="row" align="center" gap="3">
              <Text
                /** Very specifically 25px text to be the same size as the Logo's font size */
                className="font-bold text-(--gray-12) text-[25px] tracking-[-0.05em]"
              >
                Welcome to
              </Text>
              <Logo />
            </Flex>

            <div className="grid w-full grid-cols-6 grid-rows-[18rem_14rem] gap-3 overflow-hidden rounded-lg">
              {FEATURES.map((feature, index) => (
                <FeatureBentoCard
                  key={feature.title}
                  icon={feature.icon}
                  title={feature.title}
                  description={feature.description}
                  active={activeIndex === index}
                  index={index}
                  className={feature.className}
                  onMouseEnter={() => handleMouseEnter(index)}
                  onMouseLeave={handleMouseLeave}
                />
              ))}
            </div>
          </Flex>
        </Flex>

        <Flex direction="column" align="center" className="shrink-0 pt-[16px]">
          <OnboardingHogTip
            hogSrc={explorerHog}
            message="Let's get you set up! It only takes a minute."
          />
          <StepActions delay={0.25}>
            <Button size="3" onClick={onNext}>
              Start shipping
              <ArrowRight size={16} weight="bold" />
            </Button>
          </StepActions>
        </Flex>
      </Flex>
    </Flex>
  );
}
