import { AnthropicBedrock } from "@anthropic-ai/bedrock-sdk";
import Anthropic from "@anthropic-ai/sdk";

/** A message's content: plain text, or structured blocks (needed for tool_use / tool_result turns). */
export type LlmContent = string | Anthropic.ContentBlockParam[];

export interface LlmMessage {
  role: "user" | "assistant";
  content: LlmContent;
}

/** A tool the model may call during respond(). The loop runs `run` and feeds the result back. */
export interface LlmTool {
  name: string;
  description: string;
  inputSchema: Anthropic.Tool.InputSchema;
  run: (input: Record<string, unknown>) => Promise<string>;
}

export interface RespondOptions {
  /** Byte-stable across turns (persona + memory protocol). Cached at 1h TTL with the tools. */
  system: string;
  messages: LlmMessage[];
  /** Optional tool surface (e.g. memory_search). A stable list preserves the tools cache tier. */
  tools?: LlmTool[];
  /** Hard ceiling on tool round-trips (prevents an infinite tool loop). Default 4. */
  maxToolRounds?: number;
}

export interface LlmClient {
  /** Generate an assistant reply, running the tool loop if the model calls a tool. */
  respond(opts: RespondOptions): Promise<string>;
  /** Structured JSON output; returns the parsed value (caller validates). Single-shot, no tools. */
  json(system: string, user: string): Promise<unknown>;
}

export interface LlmModels {
  response: string;
  extract: string;
}

/** The one call we make. Both SDK clients (core + Bedrock) are wrapped to satisfy this in getLlm(). */
interface MessagesClient {
  messages: {
    create(body: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
  };
}

/** Structural shape read from either SDK's non-streaming response. */
interface ContentResponse {
  content: Array<{ type: string; text?: string }>;
}

function textOf(res: ContentResponse): string {
  return res.content
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");
}

/** Tolerate models that wrap JSON in ```json fences. */
function stripFence(s: string): string {
  const m = s.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return (m?.[1] ?? s).trim();
}

/**
 * Run a Messages call, looping while the model asks for tools (docs/95, openclaw-style). The stable
 * prefix is `tools -> system`; the system is sent as a single cache_control block (1h TTL) so that
 * prefix is cached across turns. The per-turn `messages` (history + recall + text) stays uncached —
 * it changes every request, so a breakpoint there would only ever write.
 */
async function runToolLoop(
  client: MessagesClient,
  model: string,
  opts: RespondOptions,
): Promise<string> {
  const { system, messages, tools = [], maxToolRounds = 4 } = opts;
  const byName = new Map(tools.map((t) => [t.name, t]));
  const systemBlocks: Anthropic.TextBlockParam[] = [
    { type: "text", text: system, cache_control: { type: "ephemeral", ttl: "1h" } },
  ];
  const toolDefs: Anthropic.Tool[] | undefined = tools.length
    ? tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }))
    : undefined;
  const convo: Anthropic.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  for (let round = 0; round <= maxToolRounds; round++) {
    const res = await client.messages.create({
      model,
      max_tokens: 1024,
      system: systemBlocks,
      messages: convo,
      ...(toolDefs ? { tools: toolDefs } : {}),
    });
    if (res.stop_reason !== "tool_use" || round === maxToolRounds) return textOf(res);

    // Echo the assistant turn VERBATIM (it carries the tool_use blocks the API needs to match).
    convo.push({ role: "assistant", content: res.content });
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of res.content) {
      if (block.type !== "tool_use") continue;
      const tool = byName.get(block.name);
      let out: string;
      let isError = false;
      try {
        if (tool) {
          out = await tool.run(block.input as Record<string, unknown>);
        } else {
          out = `unknown tool: ${block.name}`;
          isError = true;
        }
      } catch (e) {
        out = `tool error: ${(e as Error).message}`;
        isError = true;
      }
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: out,
        is_error: isError,
      });
    }
    convo.push({ role: "user", content: toolResults });
  }
  return "";
}

/**
 * One engine over either SDK. MODEL_PROVIDER selects the wrapped client; the wire shape is identical,
 * so the tool loop + caching are shared. `json()` stays a single-shot (extraction needs no tools/cache).
 */
export class LlmEngine implements LlmClient {
  constructor(
    private client: MessagesClient,
    private models: LlmModels,
  ) {}

  respond(opts: RespondOptions): Promise<string> {
    return runToolLoop(this.client, this.models.response, opts);
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
 * Factory. MODEL_PROVIDER = "anthropic" (API key) | "bedrock" (AWS creds: IAM user access keys on
 * the box, SSO locally). Bedrock model ids are region/account-specific inference profiles (Tokyo
 * uses the `jp.` prefix, e.g. jp.anthropic.claude-sonnet-4-5-...), so they are required from env —
 * we don't guess them. Remember the one-time Bedrock FTU model-access form for Anthropic models.
 *
 * Each SDK client is wrapped to a minimal `MessagesClient` so one engine covers both (their nominal
 * `messages` types differ, but the non-streaming `create` call is identical).
 */
export function getLlm(): LlmClient {
  const provider = process.env.MODEL_PROVIDER ?? "anthropic";
  if (provider === "bedrock") {
    const response = process.env.BEDROCK_RESPONSE_MODEL;
    const extract = process.env.BEDROCK_EXTRACT_MODEL;
    if (!response || !extract) {
      throw new Error(
        "MODEL_PROVIDER=bedrock requires BEDROCK_RESPONSE_MODEL and BEDROCK_EXTRACT_MODEL " +
          "(region-specific Bedrock inference-profile ids, e.g. jp.anthropic.claude-sonnet-4-5-...). " +
          "Also submit the Bedrock model-access FTU form once, and provide AWS creds (IAM user keys on the box / SSO locally).",
      );
    }
    const bedrock = new AnthropicBedrock({ awsRegion: process.env.AWS_REGION ?? "ap-northeast-1" });
    return new LlmEngine(
      { messages: { create: (b) => bedrock.messages.create(b) } },
      {
        response,
        extract,
      },
    );
  }
  const anthropic = new Anthropic();
  return new LlmEngine(
    { messages: { create: (b) => anthropic.messages.create(b) } },
    {
      response: process.env.RESPONSE_MODEL ?? "claude-sonnet-4-6",
      extract: process.env.EXTRACT_MODEL ?? "claude-haiku-4-5",
    },
  );
}
