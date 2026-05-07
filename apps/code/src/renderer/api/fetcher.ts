import type { createApiClient } from "./generated";

const USER_AGENT = `posthog/desktop.hog.dev; version: ${typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "unknown"}`;

export const buildApiFetcher: (config: {
  getAccessToken: () => Promise<string>;
  refreshAccessToken: () => Promise<string>;
}) => Parameters<typeof createApiClient>[0] = (config) => {
  const makeRequest = async (
    input: Parameters<Parameters<typeof createApiClient>[0]["fetch"]>[0],
    token: string,
  ): Promise<Response> => {
    const headers = new Headers();
    headers.set("Authorization", `Bearer ${token}`);
    headers.set("Content-Type", "application/json");
    headers.set("User-Agent", USER_AGENT);

    if (input.urlSearchParams) {
      input.url.search = input.urlSearchParams.toString();
    }

    const body = ["post", "put", "patch", "delete"].includes(
      input.method.toLowerCase(),
    )
      ? JSON.stringify(input.parameters?.body)
      : undefined;

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
      let response = await makeRequest(input, await config.getAccessToken());

      // Retry once on 401 after asking main for a fresh valid token again.
      if (!response.ok && response.status === 401) {
        try {
          response = await makeRequest(
            input,
            await config.refreshAccessToken(),
          );
        } catch {
          const cloned = response.clone();
          const errorResponse = await response
            .json()
            .catch(() =>
              cloned.text().then((t) => ({ error: t || `${response.status}` })),
            );
          throw new Error(
            `Failed request: [${response.status}] ${JSON.stringify(errorResponse)}`,
          );
        }
      }

      if (!response.ok) {
        const cloned = response.clone();
        const errorResponse = await response
          .json()
          .catch(() =>
            cloned.text().then((t) => ({ error: t || `${response.status}` })),
          );
        throw new Error(
          `Failed request: [${response.status}] ${JSON.stringify(errorResponse)}`,
        );
      }

      return response;
    },
  };
};
