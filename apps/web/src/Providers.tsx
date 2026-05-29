import { HostTRPCProvider } from "@posthog/host-router/react";
import { ThemeWrapper } from "@posthog/ui/primitives/ThemeWrapper";
import { QueryClientProvider } from "@tanstack/react-query";
import type React from "react";
import { HotkeysProvider } from "react-hotkeys-hook";
import { queryClient } from "./web-container";
import { hostTrpcClient } from "./web-trpc";

// Web transport wiring — the per-host counterpart of apps/code's Providers.tsx.
// @posthog/ui consumes the HOST router context (useHostTRPCClient), so web only
// needs HostTRPCProvider over the HTTP client. No electron TrpcRouter context.

export const Providers: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  return (
    <HotkeysProvider>
      <QueryClientProvider client={queryClient}>
        <HostTRPCProvider trpcClient={hostTrpcClient} queryClient={queryClient}>
          <ThemeWrapper>{children}</ThemeWrapper>
        </HostTRPCProvider>
      </QueryClientProvider>
    </HotkeysProvider>
  );
};
