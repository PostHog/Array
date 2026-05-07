import {
  getGatewayInvalidatePlanCacheUrl,
  getGatewayUsageUrl,
  getLlmGatewayUrl,
} from "@posthog/agent/posthog-api";
import { inject, injectable } from "inversify";
import { MAIN_TOKENS } from "../../di/tokens";
import { logger } from "../../utils/logger";
import type { AuthService } from "../auth/service";
import {
  type AnthropicErrorResponse,
  type AnthropicMessagesRequest,
  type AnthropicMessagesResponse,
  type LlmMessage,
  type PromptOutput,
  type UsageOutput,
  usageOutput,
} from "./schemas";

const log = logger.scope("llm-gateway");

export class LlmGatewayError extends Error {
  constructor(
    message: string,
    public readonly type: string,
    public readonly code?: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = "LlmGatewayError";
  }
}

@injectable()
export class LlmGatewayService {
  constructor(
    @inject(MAIN_TOKENS.AuthService)
    private readonly authService: AuthService,
  ) {}

  async prompt(
    messages: LlmMessage[],
    options: {
      system?: string;
      maxTokens?: number;
      model?: string;
    } = {},
  ): Promise<PromptOutput> {
    const { system, maxTokens, model = "claude-haiku-4-5" } = options;

    const auth = await this.authService.getValidAccessToken();
    const gatewayUrl = getLlmGatewayUrl(auth.apiHost);
    const messagesUrl = `${gatewayUrl}/v1/messages`;

    const requestBody: AnthropicMessagesRequest = {
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: false,
    };

    if (maxTokens !== undefined) {
      requestBody.max_tokens = maxTokens;
    }

    if (system) {
      requestBody.system = system;
    }

    log.debug("Sending request to LLM gateway", {
      url: messagesUrl,
      model,
      messageCount: messages.length,
    });

    const response = await this.authService.authenticatedFetch(
      fetch,
      messagesUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      },
    );

    if (!response.ok) {
      const errorBody = await response.text();
      let errorData: AnthropicErrorResponse | null = null;

      try {
        errorData = JSON.parse(errorBody) as AnthropicErrorResponse;
      } catch {
        log.error("Failed to parse error response", {
          errorBody,
          status: response.status,
        });
      }

      const errorMessage =
        errorData?.error?.message ||
        `HTTP ${response.status}: ${response.statusText}`;
      const errorType = errorData?.error?.type || "unknown_error";
      const errorCode = errorData?.error?.code;

      log.error("LLM gateway request failed", {
        status: response.status,
        errorType,
        errorMessage,
      });

      throw new LlmGatewayError(
        errorMessage,
        errorType,
        errorCode,
        response.status,
      );
    }

    const data = (await response.json()) as AnthropicMessagesResponse;

    const textContent = data.content.find((c) => c.type === "text");
    const content = textContent?.text || "";

    log.debug("LLM gateway response received", {
      model: data.model,
      stopReason: data.stop_reason,
      inputTokens: data.usage.input_tokens,
      outputTokens: data.usage.output_tokens,
    });

    return {
      content,
      model: data.model,
      stopReason: data.stop_reason,
      usage: {
        inputTokens: data.usage.input_tokens,
        outputTokens: data.usage.output_tokens,
      },
    };
  }

  async fetchUsage(): Promise<UsageOutput> {
    const auth = await this.authService.getValidAccessToken();
    const usageUrl = getGatewayUsageUrl(auth.apiHost);

    log.debug("Fetching usage from gateway", { url: usageUrl });

    const response = await this.authService.authenticatedFetch(fetch, usageUrl);

    if (!response.ok) {
      throw new LlmGatewayError(
        `Failed to fetch usage: HTTP ${response.status}`,
        "usage_error",
        undefined,
        response.status,
      );
    }

    return usageOutput.parse(await response.json());
  }

  async invalidatePlanCache(): Promise<void> {
    const auth = await this.authService.getValidAccessToken();
    const url = getGatewayInvalidatePlanCacheUrl(auth.apiHost);

    log.debug("Invalidating plan cache", { url });

    const response = await this.authService.authenticatedFetch(fetch, url, {
      method: "POST",
    });

    if (!response.ok) {
      throw new LlmGatewayError(
        `Failed to invalidate plan cache: HTTP ${response.status}`,
        "plan_cache_error",
        undefined,
        response.status,
      );
    }
  }
}
