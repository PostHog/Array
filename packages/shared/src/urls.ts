import type { CloudRegion } from "./regions";

export function getCloudUrlFromRegion(region: CloudRegion): string {
  switch (region) {
    case "us":
      return "https://us.posthog.com";
    case "eu":
      return "https://eu.posthog.com";
    case "dev":
      return "http://localhost:8010";
  }
}

// The live-events ("livestream") service origin for a region. The canvas host
// opens the SSE connection here — never the iframe — using the brokered
// live-events JWT. Dev falls back to the local livestream port (8666), matching
// the frontend's `liveEventsHostOrigin()` fallback.
export function getLiveEventsUrlFromRegion(region: CloudRegion): string {
  switch (region) {
    case "us":
      return "https://live.us.posthog.com";
    case "eu":
      return "https://live.eu.posthog.com";
    case "dev":
      return "http://localhost:8666";
  }
}
