<p align="center">
  <strong>🐕 SHIBA</strong><br/>
  <em>あなたのことを覚えている、自分専用のAIエージェント。</em><br/>
  Telegramで話すだけ。記憶はあなたのサーバーに、あなたのものとして残る。
</p>

<p align="center">
  Self-hosted personal memory agent — persistent, human-readable memory, over Telegram.<br/>
  <em>(English README is planned. 現状このREADMEは日本語です。ソースコード・コメントは英語で書きます。)</em>
</p>

---

## SHIBAとは

SHIBAは、**セルフホスト型の個人用メモリエージェント**です。

- **覚える** — Telegramでの会話から大事なことを自動で記憶し、セッションやデバイスを跨いで思い出します。
- **思い出す** — ベクトル + 全文のハイブリッド検索で、必要なときに必要な記憶だけを返します(日本語ファーストクラス)。
- **あなたのもの** — 記憶は**あなたのサーバー(AWS Lightsail)とあなたのGitHubリポジトリ**に、人間が読めるMarkdownとして保存。ベンダーロックなし、いつでもエクスポート可能。
- **Telegramに住む** — 専用アプリを入れる必要はありません。Telegramがそのままインターフェイスです。公開ドメインも不要(long pollingで動く)。

> **v1のスコープは「記憶」だけ**です。メール返信・カレンダー登録などの**外向きの「行動」はv1には含めません**(設計は [`docs/100_action-execution-security.md`](../../docs/100_action-execution-security.md) に置き、将来の段階で安全要件が揃ってから導入します)。これにより v1 は *lethal trifecta*(私的データ × 信頼できない外部入力 × 行動能力)を**構造的に持ちません** — 下の「セキュリティ」参照。

---

## システム構成図

```
                            ┌──────────────┐
                            │   あなた      │   📱 Telegram
                            │  (オーナー)    │   (メッセージ / 画像 / 音声)
                            └──────┬───────┘
                                   │
                                   ▼
                       ┌───────────────────────┐
                       │   Telegram Bot API      │   long polling(既定・公開不要)
                       │   または webhook(任意)   │   完全無料 / 送信上限なし
                       └───────────┬────────────┘
                                   │ getUpdates(outbound)/ または署名付きwebhook
                                   ▼
 ┌──────────────────────────────────────────────────────────────────────┐
 │  AWS Lightsail(東京・常駐VPS / 4GB)        ◀── SHIBA本体が24時間動く     │
 │                                                                        │
 │   SHIBA app(常駐プロセス)                                              │
 │     ├ Channel Adapter   : Telegram の入出力(LINE は将来の追加アダプタ)   │
 │     ├ Turn Loop         : ユーザ毎に直列・応答生成(60秒制約なし)        │
 │     └ Background Worker  : 記憶抽出 / 整理(dreaming) / 朝のダイジェスト   │
 │                                                                        │
 │   📁 data/memory/   ◀── 【真実の源】Markdown + git(人間が読める記憶)      │
 │   📁 data/state/    ◀── セッション履歴(JSONL)・ローカル状態              │
 └───────┬─────────────────────────┬───────────────────────┬─────────────┘
         │                         │                       │
         ▼                         ▼                       ▼
 ┌──────────────┐         ┌────────────────┐       ┌────────────────┐
 │ TiDB Cloud    │         │ LLM            │       │ GitHub         │
 │ Starter(無料) │         │ Anthropic API  │       │ (private repo) │
 │ 【派生索引】    │         │  or Bedrock    │       │ 記憶のオフサイト │
 │ vector + 全文  │         │ 応答 / 抽出 /   │       │ バックアップ     │
 │ + 自動embed +  │         │ 夜間バッチ      │       │ (git push)     │
 │ state         │         │                │       │                │
 └──────────────┘         └────────────────┘       └────────────────┘
   ↑ 検索のための索引。            ↑ 文章生成・            ↑ Lightsailが飛んでも
   DROPしても data/memory から    記憶抽出のみ。          記憶はここから復元。
   reindex で完全復元できる。      本文を送る。
```

---

## 各サービスの役割

| サービス | 役割 | 何が保存されるか |
|---|---|---|
| **Telegram Bot API** | 日常の入出力。メッセージ受信(long polling 既定 / webhook 任意)、返信送信。**完全無料・送信上限なし・公開ドメイン不要** | — |
| **AWS Lightsail**(常駐VPS) | SHIBA本体が24時間動く場所。**記憶の真実の源(Markdown+git)をローカルディスクに保持** | `data/memory/`(記憶)・`data/state/`(セッション履歴・状態) |
| **TiDB Cloud Starter** | **派生索引**。ハイブリッド検索(ベクトル + 全文)、DB内自動embedding、fact行の状態管理。**消しても `reindex` で再構築可能** | `chunks` / `facts` / `st_*`(索引・状態テーブル) |
| **LLM**(Anthropic API または Amazon Bedrock) | 応答生成・記憶の抽出/統合・夜間バッチ。**本文を送信するのみ(保存はしない)** | — |
| **GitHub**(private repo) | 記憶 git リポジトリの**オフサイトバックアップ**。Lightsailが消えても記憶を復元できる | `data/memory/` のミラー |

> 外部データ(Gmail / Google Calendar 等)の**取り込み**と、外向きの**行動**(返信・登録)は v1 スコープ外です。設計上の置き場は [`docs/99_integrations-and-mcp.md`](../../docs/99_integrations-and-mcp.md) / [`docs/100_action-execution-security.md`](../../docs/100_action-execution-security.md)。

---

## データはどこに保存されるか

SHIBAは「**真実の源**」と「**派生・再構築できるもの**」を明確に分けています。

| 種別 | 場所 | 内容 | 失ったら |
|---|---|---|---|
| 🟢 **真実の源**(source of record) | Lightsail ローカルディスク `data/memory/`(git管理)+ あなたのGitHub private repo | `MEMORY.md`(常駐記憶)/ `memory/YYYY-MM-DD.md`(日次ノート + facts)/ `profile.md` | **致命的** → GitHubから復元 |
| 🔵 **派生索引**(disposable) | TiDB Cloud Starter | 検索用の `chunks` / `facts`(ベクトル・全文索引・state・**source_trust**)| `reindex --all` で `data/memory` から完全再構築 |
| 🟡 **状態**(再構築不能) | TiDB `st_*` テーブル + 週次JSONLスナップショット | recall統計 / メトリクス / フィードバック | 消失許容(数週間で再蓄積) |
| ⚪ **会話履歴** | Lightsail ローカル `data/state/sessions/`(JSONL) | セッションのトランスクリプト | 過去会話検索が失われるのみ |
| 🔴 **秘密情報** | `.env`(権限0600) | API キー・トークン | コード・記憶・ログには**決して入れない** |

> **設計思想**: 記憶は**人間が読めるMarkdown**であり、**gitで履歴が残り、いつでも他へエクスポートできる**。データベース(TiDB)はあくまで「速く検索するための索引」で、捨てても記憶そのものは失われません。

📖 **実際にどう保存されるかの具体例**(1本の会話を追って Markdown と TiDB の中身を見る)→ [`docs/data-storage.md`](docs/data-storage.md)

---

## 💰 月額コスト

**個人利用(1日20ターン程度)の目安: 約 $35〜45 / 月**。内訳:

| サービス | プラン | 月額 |
|---|---|---|
| **AWS Lightsail** | 4GBプラン(推奨。AWS公式もOpenClaw向けに4GB推奨) | **約 $20〜24** |
| TiDB Cloud Starter | 無料枠(5GiB行 + 5GiB列 + 50M RU/月) | **$0** |
| Telegram Bot API | 完全無料(送信上限なし) | **$0** |
| **LLM**(Anthropic API or Bedrock) | 約600ターン/月(Sonnet応答 + Haiku抽出 + 夜間バッチ) | **約 $20** |
| embedding | TiDB自動embedding × Gemini(`gemini-embedding-2` @ 1536、BYOK)→ Gemini ~$0.15/Mトークン | **<$1** |
| GitHub | 無料枠内 | **$0** |
| **合計** | | **約 $35〜45 / 月** |

**コストを下げるには:**
- Lightsailを **2GBプラン(約$12/月)** に。SHIBAはベクトル計算・embedding・LLMを全て外部に逃がすので、最小構成でも動きます → 合計 **$30/月台前半**。
- LLMをデフォルトの **Sonnet** のままにする(Opus主力にすると LLM が ~$27/月に上昇)。
- **Amazon Bedrock(Lightsail の IAM ロール経由)** を使えば、Anthropic API キーの管理が不要に(コストはほぼ同等)。

> 注: 料金は2026-06時点の概算です。Lightsail / LLM の最新料金で必ず確認してください。LLMコストは使用量とモデル選択に比例します。

---

## セキュリティ — 「LLMは乗っ取られる前提」で設計

**v1 は外向きの行動を一切しません**(メール送信・カレンダー登録なし)。外部データの自動取り込みもありません。したがって v1 は *lethal trifecta*(私的データ × 信頼できない外部入力 × **行動能力**)の3本目の脚を**構造的に持たず**、「受信メールの指示であなたの名義で勝手に行動する」類の攻撃は**そもそも成立しません**。行動を足す将来段階の設計は [`docs/100`](../../docs/100_action-execution-security.md) に分離してあります。

その上で SHIBA は、**LLMの賢さに頼らず、構造で**境界を守ります:

- **アクセス境界(既定deny)** — Telegram は誰でも bot に話しかけられるため、**登録されたオーナー以外のメッセージは記憶に触れさせません**。オーナー登録は起動時のワンタイムコード方式。
- **プロンプトインジェクション防御** — 外部由来テキスト(転送・貼り付け・画像OCR・将来の検索結果)は `<untrusted_input>` で「データであって命令ではない」と構造的に囲い、入り口と出口で二重サニタイズ + Unicode正規化(日本語の言い換えパターンも対象)。
- **記憶の汚染ロンダリング防御(source_trust)** — あなたが貼り付け・転送・OCRした**他人由来のテキストから抽出された事実**には `source_trust=untrusted` を刻みます。これらは**常駐記憶(MEMORY.md)へ自動昇格されず**、想起時は信頼済み記憶と区別して降格・明示ラベルし、将来の行動の引き金には**決して**なりません。`/remember` で明示的に承認したものだけが信頼済みに昇格します。攻撃者が「正当な好み」を装った事実を記憶に植え、後から信頼済みとして悪用する経路を断ちます。
- **秘密情報の三層防御** — 抽出プロンプトで「値でなく事実」、入力前のPII/secret scrub(Luhn検証付き)、ログredaction(import時固定で無効化不可)。
- **テレメトリなし** — 外部送信はあなたが設定したサービス(LLM/TiDB/Telegram)のみ。

詳細は [`docs/98_security-design.md`](../../docs/98_security-design.md)。

---

## 主な機能

- 🧠 **永続記憶** — 会話から事実を抽出し、矛盾は統合(ADD/UPDATE/DELETE)、間隔を空けて思い出されたものは長期記憶に昇格(spaced-repetition)。
- 🔍 **ハイブリッド検索** — ベクトル + 全文(BM25)を融合。日本語ファーストクラス。繋がり(entity)で精度を底上げ。
- ☀️ **朝のダイジェスト** — 昨日のハイライト・今日に関わる約束・放置中の約束を毎朝。
- ⏳ **時間を理解** — 「昨日」「先週末」を絶対日付に解決。「いつの話だっけ?」に答えられる。
- 🔒 **プライベート** — あなたのインフラ、あなたのデータ。

---

## セットアップ(概要)

> 詳細な手順は実装後に追記します。全体の流れ:

1. **AWS Lightsail** インスタンスを作成(東京、4GB)。
2. **TiDB Cloud Starter** クラスタを作成(無料、東京)、DSNを取得。
3. **Telegram bot** を [@BotFather](https://t.me/BotFather) で作成し、bot token を取得(公開ドメイン不要 — long polling で動きます)。
4. **記憶用のGitHub private repo** を作成(オフサイトバックアップ)。
5. `.env` に各認証情報を設定し、`docker compose up`。
6. bot に話しかけ → 起動ログのワンタイムコードを送ってオーナー登録 → 会話開始。

> SHIBAは `docker compose up` + `.env` 記入だけで、「話す → 覚える → 翌日思い出す」が**全機能デフォルトONで動く**ことを出荷基準にします。

---

## 技術スタック

- **言語/ランタイム**: TypeScript + Node.js 22 LTS + pnpm
- **ホスティング**: AWS Lightsail(常駐VPS、Docker Compose)
- **索引DB**: TiDB Cloud Starter(MySQL互換、ベクトル + 全文検索 + 自動embedding)
- **記憶ストア**: Markdown + git(真実の源)+ GitHub private repo(バックアップ)
- **インターフェイス**: Telegram(本番)。LINE は将来の追加 ChannelAdapter
- **LLM**: Anthropic API または Amazon Bedrock(Claude)
- **ライセンス**: Apache-2.0

---

## Contributing / Development

- **プロジェクトの言語は英語**: ソースコード・コメント・コミットメッセージ・課題は英語で書きます。ドキュメントは日本語のものもあります(本READMEは現状日本語)。
- 詳細な開発規約は実装開始時に追記します。

---

## ライセンス

Apache License 2.0

---

## 名前の由来

**SHIBA** は柴犬(Shiba Inu)から。忠実で、賢く、あなたのそばにいて、あなたのことをちゃんと覚えている。🐕
