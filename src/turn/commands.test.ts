import { describe, expect, it, vi } from "vitest";
import type { StoredFact } from "../memory/store.js";
import type { SearchHit } from "../types.js";
import { type CommandDeps, PauseRegistry, handleCommand, parseCommand } from "./commands.js";
import type { MemoryWriter } from "./turn-loop.js";

describe("parseCommand", () => {
  it("parses /cmd, /cmd@bot, and args; ignores non-commands", () => {
    expect(parseCommand("/help")).toEqual({ cmd: "help", arg: "" });
    expect(parseCommand("/search 田中 さん")).toEqual({ cmd: "search", arg: "田中 さん" });
    expect(parseCommand("/forget@MAME_SHIBA_BOT コーヒー")).toEqual({
      cmd: "forget",
      arg: "コーヒー",
    });
    expect(parseCommand("ふつうの会話")).toBeNull();
    expect(parseCommand("3/4 の予定")).toBeNull();
  });
});

function deps(over: Partial<CommandDeps> = {}): {
  deps: CommandDeps;
  store: MemoryWriter;
  facts: StoredFact[];
} {
  const facts: StoredFact[] = [
    {
      claim: "コーヒーはブラック",
      kind: "preference",
      entities: ["coffee"],
      validFrom: null,
      sourceTrust: "owner",
      state: "active",
      relPath: "MEMORY.md",
    },
  ];
  const store: MemoryWriter = {
    appendFacts: vi.fn(async () => {}),
    appendNote: vi.fn(async () => {}),
    readFacts: vi.fn(async () => facts),
    supersede: vi.fn(async () => 1),
    commit: vi.fn(async () => {}),
  };
  const d: CommandDeps = {
    search: vi.fn(async () => [
      { id: "1", claim: "ヒット", sourceTrust: "owner", score: 1, routes: ["fts"] } as SearchHit,
    ]),
    store,
    reindex: vi.fn(async () => {}),
    pause: new PauseRegistry(),
    scrubPii: true,
    ...over,
  };
  return { deps: d, store, facts };
}

describe("handleCommand", () => {
  it("returns null for non-commands (caller does a normal turn)", async () => {
    expect(await handleCommand("u", "こんにちは", deps().deps)).toBeNull();
  });

  it("/help lists commands", async () => {
    expect(await handleCommand("u", "/help", deps().deps)).toContain("/search");
  });

  it("/search runs search and formats hits", async () => {
    const d = deps().deps;
    expect(await handleCommand("u", "/search コーヒー", d)).toContain("ヒット");
    expect(d.search).toHaveBeenCalledWith("コーヒー");
  });

  it("/remember appends + reindexes", async () => {
    const { deps: d, store } = deps();
    const out = await handleCommand("u", "/remember 紅茶派になった", d);
    expect(out).toContain("覚えたよ");
    expect(store.appendFacts).toHaveBeenCalledOnce();
    expect(d.reindex).toHaveBeenCalledOnce();
  });

  it("/forget supersedes a matching fact", async () => {
    const { deps: d, store } = deps();
    const out = await handleCommand("u", "/forget コーヒー", d);
    expect(out).toContain("取り消した");
    expect(store.supersede).toHaveBeenCalledOnce();
  });

  it("/pause and /resume toggle the registry", async () => {
    const d = deps().deps;
    await handleCommand("u", "/pause", d);
    expect(d.pause.isPaused("u")).toBe(true);
    await handleCommand("u", "/resume", d);
    expect(d.pause.isPaused("u")).toBe(false);
  });

  it("/status reports active + untrusted counts and pause state", async () => {
    const d = deps().deps;
    d.pause.set("u", true);
    const out = await handleCommand("u", "/status", d);
    expect(out).toContain("有効 1件");
    expect(out).toContain("停止中");
  });

  it("unknown command is rejected gracefully", async () => {
    expect(await handleCommand("u", "/wat", deps().deps)).toContain("知らないコマンド");
  });
});
