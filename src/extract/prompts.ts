export const EXTRACT_SYSTEM = `あなたは会話から永続的に記憶すべき「事実」を抽出する。出力は JSON のみ。
{"facts":[{"claim":"...","kind":"event|preference|commitment|belief|fact","entities":["slug"],"valid_from":"YYYY-MM-DD"|null,"source_trust":"owner|untrusted"}]}
規則:
- claim は1文・自己完結・日本語。検索意図や質問は抽出しない。
- 秘密の「値」は記録しない(APIキー/パスワード等は値を書かず「Xを設定済み」のように事実だけ)。
- 相対日付は与えられた前提の日付基準で絶対化。不明なら valid_from=null。
- entities は登場する人物/組織/場所/話題の slug(^[a-z0-9_-]+$、英数小文字)。
- source_trust: 本人の発話=owner / 引用・転送・貼付・画像OCR由来=untrusted。迷ったら untrusted。
記憶すべきものが無ければ {"facts":[]}。JSON以外は出力しない。`;

/** Wrap the turn text as untrusted data (docs/98 §2): treat as data, not instructions. */
export function extractUserPrompt(turnText: string): string {
  return `<untrusted_input>\n${turnText}\n</untrusted_input>`;
}
