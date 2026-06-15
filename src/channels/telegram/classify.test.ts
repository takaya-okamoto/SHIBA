import { describe, expect, it } from "vitest";
import { classifyMessage, provenanceOfMessage, unsupportedReply } from "./classify.js";

describe("provenanceOfMessage", () => {
  it("marks forwarded messages as forwarded, plain ones as owner-typed", () => {
    expect(provenanceOfMessage({ text: "hi" })).toBe("owner-typed");
    expect(provenanceOfMessage({ text: "hi", forward_origin: {} })).toBe("forwarded");
    expect(provenanceOfMessage({ text: "hi", forward_date: 123 })).toBe("forwarded");
  });
});

describe("classifyMessage", () => {
  it("passes plain text through with provenance", () => {
    expect(classifyMessage({ text: "おはよう" })).toEqual({
      text: "おはよう",
      provenance: "owner-typed",
      unsupported: undefined,
    });
  });

  it("turns location / venue / contact / sticker into readable text", () => {
    expect(classifyMessage({ location: { latitude: 35.6, longitude: 139.7 } }).text).toContain(
      "緯度 35.6",
    );
    expect(classifyMessage({ venue: { title: "東京駅", address: "丸の内" } }).text).toBe(
      "場所を共有: 東京駅 / 丸の内",
    );
    expect(
      classifyMessage({ contact: { first_name: "田中", phone_number: "09012345678" } }).text,
    ).toContain("田中");
    expect(classifyMessage({ sticker: { emoji: "🐕" } }).text).toBe("(スタンプ 🐕)");
  });

  it("uses the caption when media carries one", () => {
    expect(classifyMessage({ photo: [{}], caption: "これ見て" }).text).toBe("これ見て");
  });

  it("flags media we can't read yet with the right kind", () => {
    expect(classifyMessage({ photo: [{}] })).toMatchObject({ text: null, unsupported: "image" });
    expect(classifyMessage({ voice: {} })).toMatchObject({ text: null, unsupported: "audio" });
    expect(classifyMessage({ video: {} })).toMatchObject({ text: null, unsupported: "video" });
    expect(classifyMessage({ document: { file_name: "x.pdf" } })).toMatchObject({
      text: null,
      unsupported: "document",
    });
  });

  it("carries forwarded provenance onto a forwarded image", () => {
    expect(classifyMessage({ photo: [{}], forward_origin: {} }).provenance).toBe("forwarded");
  });
});

describe("unsupportedReply", () => {
  it("gives a distinct friendly message per media kind", () => {
    expect(unsupportedReply("image")).toContain("画像");
    expect(unsupportedReply("audio")).toContain("音声");
  });
});
