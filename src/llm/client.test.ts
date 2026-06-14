import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { LlmEngine, type LlmTool } from "./client.js";

type Block = Record<string, unknown>;
const msg = (stop_reason: string, content: Block[]): Anthropic.Message =>
  ({ stop_reason, content }) as unknown as Anthropic.Message;

const TOOL: LlmTool = {
  name: "memory_search",
  description: "desc",
  inputSchema: { type: "object", properties: {}, required: [] },
  run: async () => "result",
};

/** LlmEngine over a fake messages.create that returns canned responses in order. */
function engineWith(responses: Anthropic.Message[]) {
  const create = vi.fn(
    async (_b: Anthropic.MessageCreateParamsNonStreaming) => responses.shift() as Anthropic.Message,
  );
  const engine = new LlmEngine({ messages: { create } }, { response: "m-resp", extract: "m-ext" });
  return { engine, create };
}

describe("LlmEngine.respond (cache + tool loop)", () => {
  it("sends system as a single 1h-cached block and maps tools without leaking run()", async () => {
    const { engine, create } = engineWith([msg("end_turn", [{ type: "text", text: "hi" }])]);
    const out = await engine.respond({
      system: "PERSONA",
      messages: [{ role: "user", content: "q" }],
      tools: [TOOL],
    });
    expect(out).toBe("hi");
    const body = create.mock.calls[0]?.[0];
    expect(body?.system).toEqual([
      { type: "text", text: "PERSONA", cache_control: { type: "ephemeral", ttl: "1h" } },
    ]);
    expect(body?.tools).toEqual([
      {
        name: "memory_search",
        description: "desc",
        input_schema: { type: "object", properties: {}, required: [] },
      },
    ]);
  });

  it("runs the tool loop: tool_use -> run(input) -> tool_result -> final text", async () => {
    const { engine, create } = engineWith([
      msg("tool_use", [
        { type: "tool_use", id: "tu_1", name: "memory_search", input: { query: "猫" } },
      ]),
      msg("end_turn", [{ type: "text", text: "答え" }]),
    ]);
    const run = vi.fn(async (input: Record<string, unknown>) => `found:${input.query}`);
    const out = await engine.respond({
      system: "S",
      messages: [{ role: "user", content: "猫の話" }],
      tools: [{ ...TOOL, run }],
    });
    expect(out).toBe("答え");
    expect(run).toHaveBeenCalledWith({ query: "猫" });
    const msgs = create.mock.calls[1]?.[0]?.messages ?? [];
    expect(msgs.at(-2)).toMatchObject({ role: "assistant" }); // tool_use turn echoed verbatim
    const lastContent = msgs.at(-1)?.content as unknown as Block[];
    expect(lastContent[0]).toMatchObject({
      type: "tool_result",
      tool_use_id: "tu_1",
      content: "found:猫",
    });
  });

  it("stops at maxToolRounds and returns text-so-far (no infinite loop)", async () => {
    const loop = () =>
      msg("tool_use", [{ type: "tool_use", id: "x", name: "memory_search", input: {} }]);
    const { engine, create } = engineWith([loop(), loop(), loop(), loop()]);
    const out = await engine.respond({
      system: "S",
      messages: [{ role: "user", content: "q" }],
      tools: [TOOL],
      maxToolRounds: 2,
    });
    expect(out).toBe(""); // final response was tool_use only -> textOf == ""
    expect(create).toHaveBeenCalledTimes(3); // rounds 0,1 execute; round 2 hits the cap and returns
  });

  it("textOf concatenates only text blocks (ignores tool_use)", async () => {
    const { engine } = engineWith([
      msg("end_turn", [
        { type: "tool_use", id: "i", name: "x", input: {} },
        { type: "text", text: "A" },
        { type: "text", text: "B" },
      ]),
    ]);
    expect(await engine.respond({ system: "S", messages: [{ role: "user", content: "q" }] })).toBe(
      "AB",
    );
  });
});
