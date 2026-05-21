import { OnboardingHogTip } from "@features/onboarding/components/OnboardingHogTip";
import { Flex, Text } from "@radix-ui/themes";
import type { CloudRegion } from "@shared/types/regions";
import { OAuthControls } from "./OAuthControls";

interface SignInCardProps {
  hogSrc: string;
  hogMessage: string;
  subtitle: string;
  onAuthInitiated?: (region: CloudRegion) => void;
}

export function SignInCard({
  hogSrc,
  hogMessage,
  subtitle,
  onAuthInitiated,
}: SignInCardProps) {
  return (
    <Flex direction="column" gap="4">
      <Flex direction="column" gap="2">
        <Text className="font-bold text-(--gray-12) text-2xl">
          Sign in / sign up with PostHog
        </Text>
        <Text className="text-(--gray-11) text-sm">{subtitle}</Text>
      </Flex>
      <OAuthControls onAuthInitiated={onAuthInitiated} />
      <OnboardingHogTip hogSrc={hogSrc} message={hogMessage} />
    </Flex>
  );
}
