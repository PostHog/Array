import { LLM_GATEWAY_SERVICE } from "@posthog/core/llm-gateway/identifiers";
import {
  HELPER_GATEWAY_MODEL,
  type LlmGatewayService,
} from "@posthog/core/llm-gateway/llm-gateway";
import { inject, injectable } from "inversify";

@injectable()
export class SkillGeneratorService {
  constructor(
    @inject(LLM_GATEWAY_SERVICE) private readonly gateway: LlmGatewayService,
  ) {}

  async generate(
    name: string,
    hint: string,
    signal?: AbortSignal,
  ): Promise<{ description: string; body: string }> {
    const result = await this.gateway.prompt(
      [
        {
          role: "user",
          content: `Write a skill definition for a Claude Code skill named "${name}".${hint ? `\n\nContext: ${hint}` : ""}

Respond in this exact format — no other text:

DESCRIPTION: <one sentence: when should an agent invoke this skill and what does it accomplish>

<body>
<lead paragraph — 1-2 sentences expanding on when/what, no heading>

## When to use
- <specific trigger situation>
- <specific trigger situation>
- <specific trigger situation>

## Instructions
1. <step>
2. <step>
3. <step>
</body>`,
        },
      ],
      {
        system:
          "You write concise, actionable skill definitions for Claude Code agents. Be direct and specific. No boilerplate.",
        model: HELPER_GATEWAY_MODEL,
        maxTokens: 800,
        signal,
      },
    );

    return parseGeneratorOutput(result.content);
  }
}

function parseGeneratorOutput(raw: string): {
  description: string;
  body: string;
} {
  const descMatch = raw.match(/^DESCRIPTION:\s*(.+)/m);
  const description = descMatch ? descMatch[1].trim() : "";

  const bodyStart = raw.indexOf("<body>");
  const bodyEnd = raw.indexOf("</body>");
  let body: string;
  if (bodyStart !== -1 && bodyEnd !== -1) {
    body = raw.slice(bodyStart + "<body>".length, bodyEnd).trim();
  } else {
    // Fallback: everything after the DESCRIPTION line
    body = descMatch
      ? raw.slice(raw.indexOf(descMatch[0]) + descMatch[0].length).trimStart()
      : raw;
  }

  return { description, body };
}
