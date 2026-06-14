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
    expect(buildDigest([], [])).toBeNull();
  });
  it("lists due and overdue commitments", () => {
    const t = buildDigest(["歯医者 9時"], ["メール返信"]);
    expect(t).toContain("今日の予定");
    expect(t).toContain("・歯医者 9時");
    expect(t).toContain("気になっている約束");
    expect(t).toContain("・メール返信");
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
