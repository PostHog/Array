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
 * Identifies once per user when their profile loads, and resets on logout so
 * the next session starts anonymous and events don't bleed across accounts.
 * Must be used inside PostHogProvider.
 */
export function useIdentifyUser() {
  const posthog = usePostHog();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const { data: user } = useUserQuery();
  const identifiedUuid = useRef<string | null>(null);

  useEffect(() => {
    if (!posthog) return;

    if (!isAuthenticated) {
      // Reset only if we previously identified, otherwise we'd churn the
      // anonymous distinct id on every render before sign-in.
      if (identifiedUuid.current) {
        posthog.reset();
        identifiedUuid.current = null;
      }
      return;
    }

    if (!user || identifiedUuid.current === user.uuid) return;

    posthog.identify(user.uuid, {
      email: user.email,
      name: [user.first_name, user.last_name].filter(Boolean).join(" "),
      is_staff: Boolean(user.is_staff),
    });

    if (user.organization) {
      posthog.group("organization", user.organization.id, {
        name: user.organization.name,
      });
    }

    identifiedUuid.current = user.uuid;
  }, [posthog, isAuthenticated, user]);
}
