import { usePathname, useSegments } from "expo-router";
import { usePostHog } from "posthog-react-native";
import { useEffect, useRef } from "react";
import { useAuthStore, useUserQuery } from "@/features/auth";

/**
 * PostHog configuration - used by PostHogProvider in _layout.tsx
 */
export const POSTHOG_API_KEY = process.env.EXPO_PUBLIC_POSTHOG_API_KEY ?? "";
export const POSTHOG_OPTIONS = {
  host: process.env.EXPO_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
  captureAppLifecycleEvents: true,
  enableSessionReplay: true,
  sessionReplayConfig: {
    maskAllTextInputs: false,
    maskAllImages: false,
    captureLog: true,
    captureNetworkTelemetry: true,
  },
  errorTracking: {
    autocapture: {
      uncaughtExceptions: true,
      unhandledRejections: true,
    },
  },
};

/**
 * Screen tracking hook for expo-router.
 * Must be used inside PostHogProvider.
 */
export function useScreenTracking() {
  const pathname = usePathname();
  const segments = useSegments();
  const posthog = usePostHog();
  const previousPathname = useRef<string | null>(null);

  useEffect(() => {
    if (posthog && pathname && pathname !== previousPathname.current) {
      const screenName =
        segments.filter((segment) => !segment.startsWith("(")).join("/") ||
        "index";

      posthog.screen(screenName, {
        pathname,
        segments: segments.join("/"),
      });

      previousPathname.current = pathname;
    }
  }, [pathname, segments, posthog]);
}

/**
 * Associates captured events (and session replays) with the signed-in user.
 * Re-identifies whenever the user's identifying properties change (email, name,
 * staff status, organization) so mid-session updates are forwarded, and resets
 * on logout so the next session starts anonymous and events don't bleed across
 * accounts. Must be used inside PostHogProvider.
 */
export function useIdentifyUser() {
  const posthog = usePostHog();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const { data: user } = useUserQuery();
  // Signature of the last forwarded payload, so we re-identify on real changes
  // but don't spam identify()/group() on every render with identical data.
  const lastIdentity = useRef<string | null>(null);

  useEffect(() => {
    if (!posthog) return;

    if (!isAuthenticated) {
      // Reset only if we previously identified, otherwise we'd churn the
      // anonymous distinct id on every render before sign-in.
      if (lastIdentity.current) {
        posthog.reset();
        lastIdentity.current = null;
      }
      return;
    }

    if (!user) return;

    const name = [user.first_name, user.last_name].filter(Boolean).join(" ");
    const isStaff = Boolean(user.is_staff);
    const signature = JSON.stringify([
      user.uuid,
      user.email,
      name,
      isStaff,
      user.organization?.id ?? null,
      user.organization?.name ?? null,
    ]);

    if (lastIdentity.current === signature) return;

    posthog.identify(user.uuid, {
      email: user.email,
      name,
      is_staff: isStaff,
    });

    if (user.organization) {
      posthog.group("organization", user.organization.id, {
        name: user.organization.name,
      });
    }

    lastIdentity.current = signature;
  }, [posthog, isAuthenticated, user]);
}
