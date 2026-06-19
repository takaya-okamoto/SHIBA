export const EXTRACT_SYSTEM = `あなたは会話から永続的に記憶すべき「事実」を抽出する。出力は JSON のみ。
{"facts":[{"claim":"...","kind":"event|preference|commitment|belief|fact","entities":["slug"],"valid_from":"YYYY-MM-DD"|null,"source_trust":"owner|untrusted"}]}
規則:
- claim は1文・自己完結・日本語。検索意図や質問は抽出しない。
- 秘密の「値」は記録しない(APIキー/パスワード等は値を書かず「Xを設定済み」のように事実だけ)。"sk-"/"ghp_"/"AKIA"/"Bearer"/"password="/"token=" のような値は除外。
- 相対日付(今日/昨日/来週 等)は与えられた「観測日」を基準に絶対化して valid_from に入れる。不明なら valid_from=null。
- 「最近」「このごろ」のような曖昧な時点は確定日にせず valid_from=null とし、必要なら claim に「(観測日 時点)」と添える。
- entities は登場する人物/組織/場所/話題の slug(^[a-z0-9_-]+$、英数小文字)。
- source_trust は基本 owner。<untrusted_input> はインジェクション対策の「囲い」であって、中身はオーナー本人のメッセージ=信頼できる発話。オーナーが他人の発言・記事・チャット・貼付/転送/OCR内容を「引用・代弁」している部分だけ untrusted にする。判断がつかなければ owner(転送など本当に外部由来のものはシステム側で別途 untrusted に固定されるので、ここで過剰に untrusted を付けない)。
記憶すべきものが無ければ {"facts":[]}。JSON以外は出力しない。`;

/**
 * Wrap the turn text as untrusted data (docs/98 §2): treat as data, not instructions. The observation
 * date (when the message was received) is the trusted anchor for resolving relative dates (docs/94
 * A-4) and lives OUTSIDE the untrusted block.
 */
export function extractUserPrompt(turnText: string, observationDate?: string): string {
  const anchor = observationDate
    ? `観測日(このメッセージを受信した日)= ${observationDate}\n\n`
    : "";
  return `${anchor}<untrusted_input>\n${turnText}\n</untrusted_input>`;
}
