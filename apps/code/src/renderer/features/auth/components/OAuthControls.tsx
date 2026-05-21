import { useOAuthFlow } from "@features/auth/hooks/useOAuthFlow";
import { Callout, Flex, Spinner } from "@radix-ui/themes";
import posthogIcon from "@renderer/assets/images/posthog-icon.svg";
import type { CloudRegion } from "@shared/types/regions";
import { RegionSelect } from "./RegionSelect";

interface OAuthControlsProps {
  onAuthInitiated?: (region: CloudRegion) => void;
}

export function OAuthControls({ onAuthInitiated }: OAuthControlsProps = {}) {
  const {
    region,
    handleAuth,
    handleRegionChange,
    handleCancel,
    isPending,
    errorMessage,
  } = useOAuthFlow();

  const handleClick = () => {
    if (isPending) {
      void handleCancel();
      return;
    }
    onAuthInitiated?.(region);
    handleAuth();
  };

  return (
    <Flex direction="column" gap="3" className="w-full">
      <RegionSelect
        region={region}
        onRegionChange={handleRegionChange}
        disabled={isPending}
      />

      {errorMessage && (
        <Callout.Root color="red" size="1">
          <Callout.Text>{errorMessage}</Callout.Text>
        </Callout.Root>
      )}

      {isPending && (
        <Callout.Root color="blue" size="1">
          <Callout.Text>Waiting for authorization...</Callout.Text>
        </Callout.Root>
      )}

      <button
        type="button"
        onClick={handleClick}
        disabled={false}
        className="flex h-[44px] w-full cursor-pointer items-center justify-center gap-[8px] rounded-[6px] font-medium text-[15px]"
        style={{
          border: isPending
            ? "1.5px solid var(--gray-6)"
            : "1.5px solid var(--accent-8)",
          backgroundColor: isPending ? "var(--gray-3)" : "var(--accent-9)",
          color: isPending ? "var(--gray-11)" : "var(--accent-contrast)",
          boxShadow: isPending ? "none" : "0 3px 0 -1px var(--accent-8)",
          transition: "opacity 150ms ease, box-shadow 100ms ease",
        }}
      >
        {isPending ? (
          <Spinner size="1" />
        ) : (
          <img src={posthogIcon} alt="" className="h-[20px] w-[20px]" />
        )}
        {isPending ? "Cancel" : "Sign in / sign up with PostHog"}
      </button>
    </Flex>
  );
}
