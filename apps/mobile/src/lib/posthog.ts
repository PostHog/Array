import * as Application from "expo-application";
import Constants from "expo-constants";
import { usePathname, useSegments } from "expo-router";
import { usePostHog } from "posthog-react-native";
import { useEffect, useRef } from "react";
import { useUserQuery } from "@/features/auth/hooks/useUserQuery";
import { useAuthStore } from "@/features/auth/stores/authStore";

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
 * Resolve the app version that should ride along on every custom event. Prefer
 * the native runtime value so OTA-updated binaries still report their actual
 * shipped version; fall back to the Expo config (app.json) when running where
 * expo-application has no native value (e.g. Expo Go, web preview).
 */
export function getAppVersion(): string | null {
  return (
    Application.nativeApplicationVersion ??
    Constants.expoConfig?.version ??
    null
  );
}

type PostHogRegisterClient = {
  register: (properties: { app_version: string }) => unknown;
};

/**
 * Register the app version as a PostHog super property so it is attached to
 * every event the client emits. No-op if the client is not yet ready or no
 * version is available.
 */
export function registerAppVersion(
  client: PostHogRegisterClient | null | undefined,
  version: string | null = getAppVersion(),
) {
  if (!client || version === null) return;
  client.register({ app_version: version });
}

/**
 * Hook variant of `registerAppVersion`. Runs once per client instance so the
 * super property is re-applied if the PostHog client is recreated.
 */
export function useRegisterAppVersion() {
  const posthog = usePostHog();

  useEffect(() => {
    registerAppVersion(posthog);
  }, [posthog]);
}

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
