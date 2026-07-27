export interface LoopRouteSearch {
  channelId?: string;
}

export function validateLoopRouteSearch(
  search: Record<string, unknown>,
): LoopRouteSearch {
  return {
    channelId:
      typeof search.channelId === "string" && search.channelId.length > 0
        ? search.channelId
        : undefined,
  };
}
