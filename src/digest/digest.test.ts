import { describe, expect, it } from "vitest";
import { buildDigest } from "./digest.js";
import { type DigestPolicy, shouldSendDigest } from "./scheduler.js";

const policy: DigestPolicy = {
  enabled: true,
  hour: 8,
  quietStartHour: 22,
  quietEndHour: 7,
  tzOffsetMin: 540, // JST
};
const at = (isoUtc: string) => Date.parse(isoUtc);

describe("buildDigest", () => {
  it("returns null when there is nothing to report (silence principle)", () => {
    expect(buildDigest({})).toBeNull();
  });

  it("lists due and overdue items", () => {
    const t = buildDigest({ dueToday: ["歯医者 9時"], overdue: ["メール返信"] });
    expect(t).toContain("おはようございます");
    expect(t).toContain("今日の予定");
    expect(t).toContain("・歯医者 9時");
    expect(t).toContain("気になっている約束");
    expect(t).toContain("・メール返信");
  });

  it("includes weather when provided", () => {
    const t = buildDigest({ weather: "東京: 雨 最高21℃ / 最低20℃ 降水100%" });
    expect(t).toContain("今日の天気");
    expect(t).toContain("東京: 雨");
  });

  it("shows upcoming items with a day countdown and JP date", () => {
    const t = buildDigest({
      today: "2026-06-25",
      upcoming: [{ claim: "西麻布の鶫で会食", date: "2026-07-01" }],
    });
    expect(t).toContain("このあとの予定");
    expect(t).toContain("7月1日 西麻布の鶫で会食(あと6日)");
  });

  it("does not repeat the date when the claim already states it", () => {
    const t = buildDigest({
      today: "2026-06-25",
      upcoming: [{ claim: "7月1日19時から西麻布の鶫で会食", date: "2026-07-01" }],
    });
    expect(t).toContain("・7月1日19時から西麻布の鶫で会食(あと6日)");
    expect(t).not.toContain("7月1日 7月1日");
  });

  it("appends the proactive note (no internal-maintenance framing)", () => {
    const t = buildDigest({ nudge: "会食まであと少し、手土産の準備はいい感じ?" });
    expect(t).toContain("会食まであと少し");
    expect(t).not.toContain("ゆうべ気づいたこと");
  });
});

describe("shouldSendDigest", () => {
  // JST = UTC+9, so 08:30 JST on Jun 15 == 23:30 UTC on Jun 14.
  it("sends at/after the digest hour on a fresh day", () => {
    expect(shouldSendDigest(at("2026-06-14T23:30:00Z"), "2026-06-14", policy)).toBe(true);
  });
  it("does not send before the digest hour", () => {
    // 05:00 JST Jun 15
    expect(shouldSendDigest(at("2026-06-14T20:00:00Z"), null, policy)).toBe(false);
  });
  it("does not send twice on the same local day", () => {
    expect(shouldSendDigest(at("2026-06-14T23:30:00Z"), "2026-06-15", policy)).toBe(false);
  });
  it("respects quiet hours (23:00 JST)", () => {
    expect(shouldSendDigest(at("2026-06-14T14:00:00Z"), null, policy)).toBe(false);
  });
  it("is off when disabled", () => {
    expect(shouldSendDigest(at("2026-06-14T23:30:00Z"), null, { ...policy, enabled: false })).toBe(
      false,
    );
  });
});
