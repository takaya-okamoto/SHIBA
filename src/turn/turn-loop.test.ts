import { describe, expect, it, vi } from "vitest";
import type { LlmClient, RespondOptions } from "../llm/client.js";
import type { SearchHit } from "../types.js";
import { InMemoryAllowlist } from "./allowlist.js";
import { type MemoryWriter, TurnLoop } from "./turn-loop.js";

const fakeLlm = (over: Partial<LlmClient> = {}): LlmClient => ({
  respond: async () => "reply",
  json: async () => ({
    facts: [
      {
        claim: "コーヒーはブラック",
        kind: "preference",
        entities: ["owner"],
        valid_from: null,
        source_trust: "owner",
      },
    ],
  }),
  ...over,
});

const noStore = (): MemoryWriter => ({
  appendFacts: async () => {},
  appendNote: async () => {},
  readFacts: async () => [],
  supersede: async () => 0,
  commit: async () => {},
});
const hit = (claim: string, trust: "owner" | "untrusted"): SearchHit => ({
  id: "1",
  claim,
  sourceTrust: trust,
  score: 1,
  routes: ["vector"],
});

describe("TurnLoop.handleMessage", () => {
  it("denies a non-allowlisted user with the wrong code", async () => {
    const t = new TurnLoop({
      llm: fakeLlm(),
      search: async () => [],
      allowlist: new InMemoryAllowlist(),
      store: noStore(),
      reindex: async () => {},
      ownerCode: "C",
    });
    expect(await t.handleMessage("u", "hi")).toContain("セットアップコード");
  });

  it("registers with the one-time code", async () => {
    const a = new InMemoryAllowlist();
    const t = new TurnLoop({
      llm: fakeLlm(),
      search: async () => [],
      allowlist: a,
      store: noStore(),
      reindex: async () => {},
      ownerCode: "C",
    });
    expect(await t.handleMessage("u", "C")).toContain("登録");
    expect(await a.isAllowed("u")).toBe(true);
  });

  it("injects recall on the user turn (not system), offers memory_search, labels untrusted", async () => {
    const a = new InMemoryAllowlist();
    await a.add("u");
    const respond = vi.fn(async (_opts: RespondOptions) => "ok");
    const search = vi.fn(async () => [
      hit("信頼できる記憶", "owner"),
      hit("怪しい記憶", "untrusted"),
    ]);
    const t = new TurnLoop({
      llm: fakeLlm({ respond }),
      search,
      allowlist: a,
      store: noStore(),
      reindex: async () => {},
      ownerCode: "C",
    });
    expect(await t.handleMessage("u", "質問")).toBe("ok");
    expect(search).toHaveBeenCalledOnce();
    const opts = respond.mock.calls[0]?.[0];
    // recall lives on the current user turn, keeping `system` byte-stable (cacheable)
    const lastUser = opts?.messages.at(-1)?.content;
    expect(typeof lastUser).toBe("string");
    expect(lastUser).toContain("<relevant-memories>");
    expect(lastUser).toContain("[untrusted] 怪しい記憶");
    expect(lastUser).toContain("信頼できる記憶");
    expect(opts?.system).not.toContain("怪しい記憶");
    const toolNames = opts?.tools?.map((tool) => tool.name);
    expect(toolNames).toContain("memory_search");
    expect(toolNames).toContain("remember");
    expect(toolNames).toContain("forget");
  });

  it("prepends recent history before the current message", async () => {
    const a = new InMemoryAllowlist();
    await a.add("u");
    const respond = vi.fn(async (_opts: RespondOptions) => "ok");
    const t = new TurnLoop({
      llm: fakeLlm({ respond }),
      search: async () => [], // no hits -> recall block empty -> user content is exactly the text
      allowlist: a,
      store: noStore(),
      reindex: async () => {},
      ownerCode: "C",
    });
    const history = [
      { role: "user" as const, content: "前の発話" },
      { role: "assistant" as const, content: "前の返答" },
    ];
    await t.handleMessage("u", "今の質問", history);
    expect(respond.mock.calls[0]?.[0]?.messages).toEqual([
      ...history,
      { role: "user", content: "今の質問" },
    ]);
  });
});

describe("TurnLoop.closeSession", () => {
  it("extracts -> writes facts -> commits -> reindexes", async () => {
    const appended: unknown[] = [];
    const store: MemoryWriter = {
      appendFacts: async (f) => {
        appended.push(...f);
      },
      appendNote: async () => {},
      readFacts: async () => [],
      supersede: async () => 0,
      commit: async () => {},
    };
    const reindex = vi.fn(async () => {});
    const t = new TurnLoop({
      llm: fakeLlm(),
      search: async () => [],
      allowlist: new InMemoryAllowlist(),
      store,
      reindex,
      ownerCode: "C",
    });
    const n = await t.closeSession("コーヒーはブラックが好き", "2026-06-13");
    expect(n).toBe(1);
    expect(appended).toHaveLength(1);
    expect(reindex).toHaveBeenCalledOnce();
  });

  it("clamps facts to untrusted when the transcript is forwarded (laundering defense, 98 §3.5)", async () => {
    const appended: { sourceTrust: string }[] = [];
    const store: MemoryWriter = {
      appendFacts: async (f) => {
        appended.push(...(f as unknown as { sourceTrust: string }[]));
      },
      appendNote: async () => {},
      readFacts: async () => [],
      supersede: async () => 0,
      commit: async () => {},
    };
    const t = new TurnLoop({
      llm: fakeLlm(), // model claims source_trust: "owner"
      search: async () => [],
      allowlist: new InMemoryAllowlist(),
      store,
      reindex: async () => {},
      ownerCode: "C",
    });
    await t.closeSession("転送された文章", "2026-06-13", "forwarded");
    expect(appended[0]?.sourceTrust).toBe("untrusted"); // clamped despite the model saying owner
  });

  it("writes an episodic prose summary (owner-typed) for the chunk recall route", async () => {
    const notes: string[] = [];
    const store: MemoryWriter = {
      appendFacts: async () => {},
      appendNote: async (text) => {
        notes.push(text);
      },
      readFacts: async () => [],
      supersede: async () => 0,
      commit: async () => {},
    };
    const llm = fakeLlm({
      // branch on the system prompt: summary call vs extraction call
      json: async (system: string) =>
        system.includes("会話メモ") ? { summary: "森社長と受託方針を相談した。" } : { facts: [] },
    });
    const t = new TurnLoop({
      llm,
      search: async () => [],
      allowlist: new InMemoryAllowlist(),
      store,
      reindex: async () => {},
      ownerCode: "C",
    });
    await t.closeSession("…会話…", "2026-06-19");
    expect(notes).toEqual(["森社長と受託方針を相談した。"]);
  });

  it("does NOT summarize a forwarded (untrusted) transcript — no episodic-chunk laundering", async () => {
    const notes: string[] = [];
    const store: MemoryWriter = {
      appendFacts: async () => {},
      appendNote: async (text) => {
        notes.push(text);
      },
      readFacts: async () => [],
      supersede: async () => 0,
      commit: async () => {},
    };
    const llm = fakeLlm({
      json: async (system: string) =>
        system.includes("会話メモ") ? { summary: "外部記事の要約" } : { facts: [] },
    });
    const t = new TurnLoop({
      llm,
      search: async () => [],
      allowlist: new InMemoryAllowlist(),
      store,
      reindex: async () => {},
      ownerCode: "C",
    });
    await t.closeSession("転送された記事", "2026-06-19", "forwarded");
    expect(notes).toEqual([]); // summary skipped for non-owner provenance
  });
});
