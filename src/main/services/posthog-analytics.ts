import { PostHog } from "posthog-node";

let posthogClient: PostHog | null = null;

export function initializePostHog() {
  if (posthogClient) {
    return posthogClient;
  }

  const apiKey = process.env.VITE_POSTHOG_API_KEY;
  const apiHost = process.env.VITE_POSTHOG_API_HOST;

  if (!apiKey) {
    return null;
  }

  posthogClient = new PostHog(apiKey, {
    host: apiHost || "https://internal-c.posthog.com",
  });

  return posthogClient;
}

export function trackAppEvent(
  eventName: string,
  properties?: Record<string, string | number | boolean>,
) {
  if (!posthogClient) {
    return;
  }

  properties = {
    ...properties,
    $process_person_profile: false,
  };

  posthogClient.capture({
    distinctId: "app-event",
    event: eventName,
    properties,
  });
}

export function identifyUser(
  userId: string,
  properties?: Record<string, string | number | boolean>,
) {
  if (!posthogClient) {
    return;
  }

  posthogClient.identify({
    distinctId: userId,
    properties,
  });
}

export async function shutdownPostHog() {
  if (posthogClient) {
    await posthogClient.shutdown();
    posthogClient = null;
  }
}

export function getPostHogClient() {
  return posthogClient;
}
