import { getAuthenticatedClient } from "@features/auth/hooks/authClient";
import type { SpendAnalysisResponse } from "@features/billing/types/spend-analysis";
import { logger } from "@utils/logger";
import { useCallback, useState } from "react";

const log = logger.scope("spend-analysis");

interface RunOptions {
  dateFrom?: string;
  dateTo?: string;
  product?: string;
}

interface UseSpendAnalysisReturn {
  data: SpendAnalysisResponse | null;
  isLoading: boolean;
  error: string | null;
  run: (options?: RunOptions) => Promise<void>;
}

export function useSpendAnalysis(): UseSpendAnalysisReturn {
  const [data, setData] = useState<SpendAnalysisResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (options: RunOptions = {}) => {
    setIsLoading(true);
    setError(null);
    try {
      const client = await getAuthenticatedClient();
      if (!client) {
        throw new Error("Not authenticated");
      }
      const result = await client.getPersonalSpendAnalysis(options);
      setData(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      log.warn("Failed to fetch spend analysis", { error: message });
      setData(null);
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { data, isLoading, error, run };
}
