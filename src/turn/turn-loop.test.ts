import { describe, expect, it, vi } from "vitest";
import type { LlmClient } from "../llm/client.js";
import type { SearchHit } from "../types.js";
import { InMemoryAllowlist } from "./allowlist.js";
import { type MemoryWriter, TurnLoop } from "./turn-loop.js";

const fakeLlm = (over: Partial<LlmClient> = {}): LlmClient => ({
  respond: async () => "reply",
  json: async () => ({
    facts: [{ claim: "コーヒーはブラック", kind: "preference", entities: ["owner"], valid_from: null, source_trust: "owner" }],
  }),
  ...over,
});

const noStore = (): MemoryWriter => ({ appendFacts: async () => {}, commit: async () => {} });
const hit = (claim: string, trust: "owner" | "untrusted"): SearchHit => ({ id: "1", claim, sourceTrust: trust, score: 1, routes: ["vector"] });

describe("TurnLoop.handleMessage", () => {
  it("denies a non-allowlisted user with the wrong code", async () => {
    const t = new TurnLoop({ llm: fakeLlm(), search: async () => [], allowlist: new InMemoryAllowlist(), store: noStore(), reindex: async () => {}, ownerCode: "C" });
    expect(await t.handleMessage("u", "hi")).toContain("セットアップコード");
  });
  it("registers with the one-time code", async () => {
    const a = new InMemoryAllowlist();
    const t = new TurnLoop({ llm: fakeLlm(), search: async () => [], allowlist: a, store: noStore(), reindex: async () => {}, ownerCode: "C" });
    expect(await t.handleMessage("u", "C")).toContain("登録");
    expect(await a.isAllowed("u")).toBe(true);
  });
  it("recalls + responds for an allowed user, labeling untrusted memories", async () => {
    const a = new InMemoryAllowlist();
    await a.add("u");
    const respond = vi.fn(async (_system: string, _messages: unknown) => "ok");
    const search = vi.fn(async () => [hit("信頼できる記憶", "owner"), hit("怪しい記憶", "untrusted")]);
    const t = new TurnLoop({ llm: fakeLlm({ respond }), search, allowlist: a, store: noStore(), reindex: async () => {}, ownerCode: "C" });
    expect(await t.handleMessage("u", "質問")).toBe("ok");
    expect(search).toHaveBeenCalledOnce();
    const system = respond.mock.calls[0]?.[0] ?? "";
    expect(system).toContain("[untrusted] 怪しい記憶");
    expect(system).toContain("信頼できる記憶");
  });
});

describe("TurnLoop.closeSession", () => {
  it("extracts -> writes facts -> commits -> reindexes", async () => {
    const appended: unknown[] = [];
    const store: MemoryWriter = { appendFacts: async (f) => { appended.push(...f); }, commit: async () => {} };
    const reindex = vi.fn(async () => {});
    const t = new TurnLoop({ llm: fakeLlm(), search: async () => [], allowlist: new InMemoryAllowlist(), store, reindex, ownerCode: "C" });
    const n = await t.closeSession("コーヒーはブラックが好き", "2026-06-13");
    expect(n).toBe(1);
    expect(appended).toHaveLength(1);
    expect(reindex).toHaveBeenCalledOnce();
  });
});
