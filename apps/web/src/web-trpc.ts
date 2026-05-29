import type { HostRouter } from "@posthog/host-router/router";
import {
  createTRPCClient,
  httpBatchLink,
  httpSubscriptionLink,
  splitLink,
} from "@trpc/client";

// The ENTIRE electron->web transport difference. The renderer builds the same
// client with `links: [ipcLink()]`; web swaps in HTTP: httpBatchLink for
// queries/mutations, httpSubscriptionLink (SSE) for subscriptions. Everything
// downstream (HOST_TRPC_CLIENT, every *_CLIENT port derived from it) is identical.
const API_URL = import.meta.env.VITE_WEB_API_URL ?? "http://localhost:8787";

export const hostTrpcClient = createTRPCClient<HostRouter>({
  links: [
    splitLink({
      condition: (op) => op.type === "subscription",
      true: httpSubscriptionLink({ url: API_URL }),
      false: httpBatchLink({ url: API_URL }),
    }),
  ],
});
