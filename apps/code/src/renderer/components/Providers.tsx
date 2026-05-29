import { HostTRPCProvider } from "@posthog/host-router/react";
import { ThemeWrapper } from "@posthog/ui/primitives/ThemeWrapper";
import { WorkspaceClientProvider } from "@posthog/workspace-client/provider";
import {
  hostTrpcClient,
  TRPCProvider,
  trpcClient,
  useTRPC,
} from "@renderer/trpc/client";
import {
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useSubscription } from "@trpc/tanstack-react-query";
import { queryClient } from "@utils/queryClient";
import type React from "react";
import { HotkeysProvider } from "react-hotkeys-hook";

function ConnectedWorkspaceProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const trpc = useTRPC();
  const rqClient = useQueryClient();
  const { data: connection } = useQuery(
    trpc.workspaceServer.getConnection.queryOptions(undefined, {
      staleTime: 30_000,
    }),
  );
  useSubscription(
    trpc.workspaceServer.onConnectionLost.subscriptionOptions(undefined, {
      onData: () => {
        rqClient.invalidateQueries({
          queryKey: trpc.workspaceServer.getConnection.queryKey(),
        });
      },
    }),
  );
  return (
    <WorkspaceClientProvider connection={connection} queryClient={queryClient}>
      {children}
    </WorkspaceClientProvider>
  );
}

export const Providers: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  return (
    <HotkeysProvider>
      <QueryClientProvider client={queryClient}>
        <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
          <HostTRPCProvider
            trpcClient={hostTrpcClient}
            queryClient={queryClient}
          >
            <ConnectedWorkspaceProvider>
              <ThemeWrapper>{children}</ThemeWrapper>
            </ConnectedWorkspaceProvider>
          </HostTRPCProvider>
        </TRPCProvider>
      </QueryClientProvider>
    </HotkeysProvider>
  );
};
