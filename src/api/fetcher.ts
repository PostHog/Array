import type { createApiClient } from "./generated";

export const buildApiFetcher: (config: {
  apiToken: string;
}) => Parameters<typeof createApiClient>[0] = (config) => {
  return {
    fetch: async (input) => {
      const headers = new Headers();
      headers.set("Authorization", `Bearer ${config.apiToken}`);

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

      let response: Response;
      try {
        response = await fetch(input.url, {
          method: input.method.toUpperCase(),
          ...(body && { body }),
          headers,
          ...input.overrides,
        });
      } catch (err) {
        throw new Error(
          `Network request failed for ${input.method.toUpperCase()} ${input.url}: ${
            err instanceof Error ? err.message : String(err)
          }`,
          { cause: err instanceof Error ? err : undefined },
        );
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
