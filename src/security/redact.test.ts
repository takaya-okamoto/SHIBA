import { describe, expect, it } from "vitest";
import { redactForLog, scrubSecrets } from "./redact.js";

describe("scrubSecrets", () => {
  it("redacts API keys, JWTs, bearer tokens, and key=value secrets", () => {
    expect(scrubSecrets("key is sk-abcdefghijklmnop1234")).toBe("key is [REDACTED]");
    expect(scrubSecrets("token=ghp_abcdefghijklmnopqrstuvwxyz0123")).toContain("[REDACTED]");
    expect(scrubSecrets("Authorization: Bearer abc.def.ghi")).toContain("[REDACTED]");
    expect(scrubSecrets("password=hunter2")).toBe("[REDACTED]");
  });

  it("redacts a Luhn-valid card number but leaves a random digit run", () => {
    expect(scrubSecrets("card 4111 1111 1111 1111")).toBe("card [REDACTED]");
    expect(scrubSecrets("order 1234 5678 9012 3456")).toContain("1234"); // fails Luhn -> kept
  });

  it("redacts email and phone when pii is on (default), keeps them when off", () => {
    expect(scrubSecrets("連絡は tanaka@example.com")).toBe("連絡は [REDACTED]");
    expect(scrubSecrets("連絡は tanaka@example.com", { pii: false })).toContain(
      "tanaka@example.com",
    );
    expect(scrubSecrets("電話は 03-1234-5678 です")).toContain("[REDACTED]");
  });

  it("leaves ordinary text alone", () => {
    expect(scrubSecrets("コーヒーはブラックが好き")).toBe("コーヒーはブラックが好き");
  });
});

describe("redactForLog", () => {
  it("redacts hard secrets but not PII (logs never carry memory content)", () => {
    expect(redactForLog("boot token=12345678:ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")).toContain(
      "[REDACTED]",
    );
    expect(redactForLog("user tanaka@example.com asked")).toContain("tanaka@example.com");
  });
});
