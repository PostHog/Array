import type { createApiClient } from "./generated";

export const buildApiFetcher: (config: {
  apiToken: string;
  onTokenRefresh?: () => Promise<string>;
}) => Parameters<typeof createApiClient>[0] = (config) => {
  const makeRequest = async (
    input: Parameters<Parameters<typeof createApiClient>[0]["fetch"]>[0],
    token: string,
  ): Promise<Response> => {
    const headers = new Headers();
    headers.set("Authorization", `Bearer ${token}`);

    if (input.urlSearchParams) {
      input.url.search = input.urlSearchParams.toString();
    }

    const body = ["post", "put", "patch", "delete"].includes(
      input.method.toLowerCase(),
    )
      ? JSON.stringify(input.parameters?.body)
      : undefined;

    if (body) {
      headers.set("Content-Type", "application/json");
    }

    if (input.parameters?.header) {
      for (const [key, value] of Object.entries(input.parameters.header)) {
        if (value != null) {
          headers.set(key, String(value));
        }
      }
    }

    try {
      const response = await fetch(input.url, {
        method: input.method.toUpperCase(),
        ...(body && { body }),
        headers,
        ...input.overrides,
      });

      return response;
    } catch (err) {
      throw new Error(
        `Network request failed for ${input.method.toUpperCase()} ${input.url}: ${
          err instanceof Error ? err.message : String(err)
        }`,
        { cause: err instanceof Error ? err : undefined },
      );
    }
  };

  return {
    fetch: async (input) => {
      let response = await makeRequest(input, config.apiToken);

      // Handle 401 with automatic token refresh
      if (!response.ok && response.status === 401 && config.onTokenRefresh) {
        try {
          const newToken = await config.onTokenRefresh();
          response = await makeRequest(input, newToken);
        } catch {
          // Token refresh failed - throw the original 401 error
          const errorResponse = await response.json();
          throw new Error(
            `Failed request: [${response.status}] ${JSON.stringify(errorResponse)}`,
          );
        }
      }

      if (!response.ok) {
        const errorResponse = await response.json();
        throw new Error(
          `Failed request: [${response.status}] ${JSON.stringify(errorResponse)}`,
        );
      }

      return response;
    },
  };
};
