import {
  ArrowRight,
  ChartLine,
  Cloud,
  GitPullRequest,
  Robot,
  Tray,
} from "@phosphor-icons/react";
import { Button, Flex, Text } from "@radix-ui/themes";
import explorerHog from "@renderer/assets/images/hedgehogs/explorer-hog.png";
import Logo from "@renderer/assets/logo";
import { useCallback, useEffect, useRef, useState } from "react";
import { FeatureBentoCard } from "./FeatureBentoCard";
import { OnboardingHogTip } from "./OnboardingHogTip";
import { StepActions } from "./StepActions";

const FEATURES = [
  {
    icon: <Tray size={28} />,
    title: "Your signals inbox",
    description:
      "Automatically surfaces the highest-impact work from your product data so you always know what to do next.",
    placeholderLabel: "Inbox preview",
    className: "col-span-4",
  },
  {
    icon: <ChartLine size={26} />,
    title: "Product data as context",
    description:
      "Agents pull in analytics, session replays and feature flags automatically.",
    placeholderLabel: "Context preview",
    className: "col-span-2",
  },
  {
    icon: <Robot size={22} />,
    title: "Any model, any harness",
    description:
      "Bring your own agent framework or pick one of ours. Swap models without changing your flow.",
    placeholderLabel: "Model picker",
    className: "col-span-2",
  },
  {
    icon: <Cloud size={22} />,
    title: "Ship work, not messages",
    description:
      "Run tasks in parallel across local and cloud environments — even while you're away.",
    placeholderLabel: "Parallel tasks",
    className: "col-span-2",
  },
  {
    icon: <GitPullRequest size={22} />,
    title: "Review and ship with confidence",
    description:
      "Inline diffs, AI-assisted review and PR creation in a single flow.",
    placeholderLabel: "Diff & PR",
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
          className="min-h-0 w-full flex-1 overflow-y-auto"
        >
          <Flex
            direction="column"
            align="start"
            style={{
              margin: "auto 0",
            }}
            className="w-full max-w-[760px] gap-6"
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

            <div className="grid w-full grid-cols-6 grid-rows-[18rem_14rem] gap-3">
              {FEATURES.map((feature, index) => (
                <FeatureBentoCard
                  key={feature.title}
                  icon={feature.icon}
                  title={feature.title}
                  description={feature.description}
                  placeholderLabel={feature.placeholderLabel}
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
