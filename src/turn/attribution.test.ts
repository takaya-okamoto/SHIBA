import { describe, expect, it } from "vitest";
import { attributeRecall } from "./attribution.js";

describe("attributeRecall", () => {
  const dinner = { claim: "7月1日19時から西麻布の鶫で森社長と東大教授との会食の予定がある" };
  const cto = { claim: "現在スタートアップでCTOをしている" };

  it("marks used when the reply echoes a recalled claim", () => {
    const reply = "今日の19時から西麻布の鶫で森社長たちとの会食だね。楽しみにしてる?";
    expect(attributeRecall(reply, [dinner, cto])).toBe(true);
  });

  it("marks not-used when the reply is unrelated to any hit", () => {
    const reply = "おはよう!今日はいい天気だね。散歩に行きたい気分だよ。";
    expect(attributeRecall(reply, [dinner, cto])).toBe(false);
  });

  it("is false for an empty reply or no hits", () => {
    expect(attributeRecall("", [dinner])).toBe(false);
    expect(attributeRecall("なにか話そう", [])).toBe(false);
  });

  it("skips claims too short to attribute", () => {
    expect(attributeRecall("うん", [{ claim: "犬" }])).toBe(false);
  });
});
