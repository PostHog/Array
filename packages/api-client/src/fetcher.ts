import type { createApiClient } from "./generated";

export type ApiFetcherConfig = {
  getAccessToken: () => Promise<string>;
  refreshAccessToken: () => Promise<string>;
  appVersion: string;
};

export const buildApiFetcher: (
  config: ApiFetcherConfig,
) => Parameters<typeof createApiClient>[0] = (config) => {
  const userAgent = `posthog/desktop.hog.dev; version: ${config.appVersion}`;

  const makeRequest = async (
    input: Parameters<Parameters<typeof createApiClient>[0]["fetch"]>[0],
    token: string,
  ): Promise<Response> => {
    const headers = new Headers();
    headers.set("Authorization", `Bearer ${token}`);
    headers.set("Content-Type", "application/json");
    headers.set("User-Agent", userAgent);

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

  const isAuthFailure = async (response: Response): Promise<boolean> => {
    if (response.status === 401) return true;
    if (response.status !== 403) return false;
    try {
      const body = (await response.clone().json()) as {
        code?: string;
        type?: string;
      } | null;
      return (
        body?.code === "authentication_failed" ||
        body?.type === "authentication_error"
      );
    } catch {
      return false;
    }
  };

  return {
    fetch: async (input) => {
      let response = await makeRequest(input, await config.getAccessToken());

      if (!response.ok && (await isAuthFailure(response))) {
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
