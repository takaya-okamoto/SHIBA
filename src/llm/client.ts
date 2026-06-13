import { AnthropicBedrock } from "@anthropic-ai/bedrock-sdk";
import Anthropic from "@anthropic-ai/sdk";

export interface LlmMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LlmClient {
  /** Generate an assistant reply. */
  respond(system: string, messages: LlmMessage[]): Promise<string>;
  /** Structured JSON output; returns the parsed value (caller validates). */
  json(system: string, user: string): Promise<unknown>;
}

export interface LlmModels {
  response: string;
  extract: string;
}

/** Structural shape read from either SDK's non-streaming response. */
interface ContentResponse {
  content: Array<{ type: string; text?: string }>;
}

function textOf(res: ContentResponse): string {
  return res.content.map((b) => (b.type === "text" ? (b.text ?? "") : "")).join("");
}

/** Tolerate models that wrap JSON in ```json fences. */
function stripFence(s: string): string {
  const m = s.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return (m?.[1] ?? s).trim();
}

export class AnthropicLlm implements LlmClient {
  constructor(
    private client: Anthropic,
    private models: LlmModels,
  ) {}
  async respond(system: string, messages: LlmMessage[]): Promise<string> {
    const res = await this.client.messages.create({
      model: this.models.response,
      max_tokens: 1024,
      system,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });
    return textOf(res);
  }
  async json(system: string, user: string): Promise<unknown> {
    const res = await this.client.messages.create({
      model: this.models.extract,
      max_tokens: 2048,
      system,
      messages: [{ role: "user", content: user }],
    });
    return JSON.parse(stripFence(textOf(res)));
  }
}

/**
 * Bedrock (option B). Same Messages API as the core SDK; credentials come from the AWS chain:
 * `aws sso login` locally, or the Lightsail instance IMDS role on the box (deploy/terraform "Option B").
 * Model ids are Bedrock-specific (region inference-profile ids, e.g. apac.anthropic.claude-...).
 */
export class BedrockLlm implements LlmClient {
  constructor(
    private client: AnthropicBedrock,
    private models: LlmModels,
  ) {}
  async respond(system: string, messages: LlmMessage[]): Promise<string> {
    const res = await this.client.messages.create({
      model: this.models.response,
      max_tokens: 1024,
      system,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });
    return textOf(res);
  }
  async json(system: string, user: string): Promise<unknown> {
    const res = await this.client.messages.create({
      model: this.models.extract,
      max_tokens: 2048,
      system,
      messages: [{ role: "user", content: user }],
    });
    return JSON.parse(stripFence(textOf(res)));
  }
}

/**
 * Factory. MODEL_PROVIDER = "anthropic" (API key) | "bedrock" (AWS creds: SSO local / IMDS role on box).
 * Bedrock model ids are region/account-specific (inference profiles), so they are required from env —
 * we don't guess them. Remember the one-time Bedrock FTU model-access form for Anthropic models.
 */
export function getLlm(): LlmClient {
  const provider = process.env.MODEL_PROVIDER ?? "anthropic";
  if (provider === "bedrock") {
    const response = process.env.BEDROCK_RESPONSE_MODEL;
    const extract = process.env.BEDROCK_EXTRACT_MODEL;
    if (!response || !extract) {
      throw new Error(
        "MODEL_PROVIDER=bedrock requires BEDROCK_RESPONSE_MODEL and BEDROCK_EXTRACT_MODEL " +
          "(region-specific Bedrock model / inference-profile ids, e.g. apac.anthropic.claude-...). " +
          "Also submit the Bedrock model-access FTU form once, and ensure AWS creds (SSO locally / instance role on the box).",
      );
    }
    const client = new AnthropicBedrock({ awsRegion: process.env.AWS_REGION ?? "ap-northeast-1" });
    return new BedrockLlm(client, { response, extract });
  }
  return new AnthropicLlm(new Anthropic(), {
    response: process.env.RESPONSE_MODEL ?? "claude-sonnet-4-6",
    extract: process.env.EXTRACT_MODEL ?? "claude-haiku-4-5",
  });
}
