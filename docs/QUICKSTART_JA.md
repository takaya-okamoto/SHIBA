# SHIBA クイックスタート（初回セットアップ）

ゼロから **Telegram で SHIBA と会話できる状態** までの手順。所要 30〜60 分。
このドキュメントは「実際に本番稼働まで辿った手順」を再現可能な形にしたものです。
途中で踏みやすい落とし穴は末尾の「トラブルシュート」に併記しています。

## 構成（できあがるもの）

| 役割 | サービス | 補足 |
|---|---|---|
| 常駐 VPS（24時間稼働） | **AWS Lightsail**（Ubuntu 22.04 / 4GB） | Docker で SHIBA を常駐 |
| 索引（ベクトル+全文+自動embedding） | **TiDB Cloud Starter**（東京 / 無料枠） | 真実の源は Markdown+git、TiDB は再構築可能な派生 |
| LLM | **Amazon Bedrock**（Claude Sonnet 4.5・東京） | IAM ユーザーのアクセスキーで認証 |
| 入出力 | **Telegram**（long polling） | 公開ポート不要・無料 |

> **真実の源 = Markdown + git、TiDB = 派生（`reindex --all` で復元可能）。** TiDB を消しても記憶は失われません。

---

## 0. 用意するもの

**アカウント**
- AWS アカウント（Lightsail + Bedrock）
- TiDB Cloud アカウント（無料）
- Telegram アカウント

**ローカルのツール**
- `git`、Terraform ≥ 1.6、AWS CLI v2、SSH 鍵（`ssh-keygen -t ed25519`）
- （任意）ローカル開発するなら Node 22 + pnpm

**コスト目安**
- Lightsail 4GB ≈ **$24/月**、TiDB Starter = **無料枠**、Bedrock = 従量（会話量次第）、Telegram = 無料

---

## 1. Telegram bot を作る（BotFather）

> Telegram には Terraform が無いので**手動が前提**。

1. Telegram で [@BotFather](https://t.me/BotFather) を開き `/newbot`
2. 表示名（例: `SHIBA`）→ ユーザー名（末尾が `_bot`、例: `MAME_SHIBA_BOT`）
3. 返ってきた **bot トークン**（`123456:ABC-...`）を控える

---

## 2. TiDB Cloud Starter クラスタを作る（東京）

1. TiDB Cloud → **Create Cluster** → **Starter**（無料）→ Region = **AWS Tokyo (`ap-northeast-1`)**
2. 作成後「**Connect**」ダイアログで接続情報を控える：
   - **Host**: `gateway01.ap-northeast-1.prod.aws.tidbcloud.com`
   - **Port**: `4000`
   - **User**: `<prefix>.root`
   - **Password**: 「Generate / Reset Password」で発行して控える
3. TLS は公開 CA で通る（`TIDB_CA_PATH` は不要）

> ⚠️ クラスタは **Terraform 管理外**（意図的に decouple）。接続情報を後で `terraform.tfvars` / `.env` に渡します。

---

## 3. AWS Bedrock を使えるようにする

### 3-1. モデルアクセス申請（FTU = First Time Use）
- Bedrock コンソール（**`ap-northeast-1`**）→ **Model access** → Anthropic Claude を有効化（初回は申請フォーム=FTU）。**"Access granted"** になるまで待つ。

### 3-2. 推論プロファイル ID を確認
- Claude 4.x は **on-demand 不可、推論プロファイル（inference profile）必須**。東京は `jp.` プレフィックス。
- 実在 ID を確認：
  ```bash
  aws bedrock list-inference-profiles --region ap-northeast-1 \
    --query "inferenceProfileSummaries[].inferenceProfileId"
  ```
- 採用例：
  - 応答（`bedrock_response_model`）= `jp.anthropic.claude-sonnet-4-5-20250929-v1:0`
  - 抽出（`bedrock_extract_model`）= haiku 系の `jp.` プロファイル（上記コマンドで実在 ID を確認して使う）

### 3-3. IAM ユーザー + アクセスキーを作る
> ⚠️ **keyless（IMDS ロールチェーン）は素の Lightsail では不可能**。IAM ユーザーのアクセスキー方式を使う。

1. IAM → ユーザー作成 → ポリシー（最小権限）：
   ```json
   { "Version": "2012-10-17", "Statement": [{
     "Effect": "Allow",
     "Action": ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
     "Resource": "*"
   }]}
   ```
2. **アクセスキー**を発行 → `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` を控える（後で箱の `.env` に入れる）

---

## 4. アプリのリポジトリ

箱は GitHub から clone します。**public なら token 不要**。本番リポジトリ: `github.com/takaya-okamoto/SHIBA`

---

## 5. Lightsail を Terraform で作る

```bash
cd OSS/shiba/deploy/terraform
cp terraform.tfvars.example terraform.tfvars
```

`terraform.tfvars` を編集（今回の構成に合わせる）：

```hcl
# アクセス
ssh_public_key = "ssh-ed25519 AAAA... you@host"   # ~/.ssh/id_ed25519.pub の中身
admin_ssh_cidr = "<あなたのグローバルIP>/32"        # curl ifconfig.me で確認
shiba_repo_url    = "https://github.com/takaya-okamoto/SHIBA.git"
github_repo_token = ""                              # public なら空

# モデル（Bedrock / IAMユーザーキー方式）
model_provider      = "bedrock"
bedrock_response_model = "jp.anthropic.claude-sonnet-4-5-20250929-v1:0"
bedrock_extract_model  = "jp.anthropic.claude-haiku-..."   # 3-2 で確認した実在 ID
aws_access_key_id      = "AKIA..."                  # 3-3 の IAM ユーザーキー
aws_secret_access_key  = "..."

# Telegram
telegram_bot_token = "123456:ABC-..."

# TiDB（step 2 の接続情報）
tidb_host     = "gateway01.ap-northeast-1.prod.aws.tidbcloud.com"
tidb_user     = "<prefix>.root"
tidb_port     = 4000
tidb_password = "<step2 で発行したパスワード>"

# embedding は既定の無料 Titan 自動embedding を使う（キー不要）
gemini_api_key = ""
```

```bash
terraform init
terraform apply
```

これで **Lightsail（Ubuntu 22.04 / 4GB）** が作られ、Docker 導入・リポジトリ clone・`.env` 生成・`docker compose up` まで自動で走ります。
`terraform output` に箱の IP と次の手順が出ます。

---

## 6. 箱で仕上げ（ビルド → migrate）

```bash
ssh -4 -i ~/.ssh/id_ed25519 ubuntu@<箱のIP>
cd /opt/shiba/app

# ビルド & 起動（pnpm は package.json で 10.15.0 に固定済み）
sudo docker compose up -d --build

# TiDB にスキーマ作成（chunks / facts / entities / fact_entities + FTS×2）
sudo docker compose run --rm app node dist/main.js migrate
```

> 補足：`migrate` は TiFlash プロビジョニングで時間がかかることがあります。SSH 切断で途中 kill されないよう、長い場合は `nohup ... &` でデタッチして `SHOW TABLES` で完了確認すると確実です。

---

## 7. Telegram で登録して会話する

```bash
# オーナー登録用のワンタイムコードをログから取得
sudo docker compose logs app | grep "owner setup code"
#   例: owner setup code: ba016eb0
```

1. Telegram で bot（例: `@MAME_SHIBA_BOT`）を開いて何か送る → **「セットアップコードを送ってください」**
2. 上で取得した**コードだけ**を送る → 登録完了
3. あとは普通に話しかければ、SHIBA が Bedrock（Claude Sonnet 4.5・東京）で応答します 🐕

> ⚠️ **コードは起動毎に再生成**（in-memory）。未登録のまま再起動すると変わります。登録後は `./data`（マウント volume）に永続するので、再起動しても再登録は不要です。

---

## トラブルシュート

```bash
sudo docker compose ps          # 稼働状態
sudo docker compose logs app    # 起動ログ・エラー

# Bedrock 単体テスト（コンテナから）
sudo docker compose exec -T app node --input-type=module -e \
  'import {AnthropicBedrock} from "@anthropic-ai/bedrock-sdk";
   const c=new AnthropicBedrock({awsRegion:process.env.AWS_REGION});
   const r=await c.messages.create({model:process.env.BEDROCK_RESPONSE_MODEL,max_tokens:16,
     messages:[{role:"user",content:"Reply with OK"}]});
   console.log(r.content[0].text);'
```

**よく踏む罠**
- **Docker ビルドが pnpm で失敗** → pnpm 11 は「未承認のビルドスクリプト」をエラー化。`package.json` の `packageManager: pnpm@10.15.0` 固定で解決済み。
- **migrate で `chunks` だけしか作られない** → schema のコメント内 `;` で文が分断されていた問題。修正済み。
- **Bedrock が AccessDenied** → keyless（IMDS）は素の Lightsail では不可。IAM ユーザーキーを `.env` に入れる。FTU フォーム未提出も疑う。
- **SSH がタイムアウトするようになった** → 自分のグローバル IP が変わり `admin_ssh_cidr` の許可から外れた可能性。Lightsail コンソールのファイアウォールで現在の IP を許可、または `admin_ssh_cidr` を更新して `terraform apply`。**ボットは long polling なので稼働には影響しません。**

---

## セキュリティ

- セットアップ中に共有した **Telegram トークン / TiDB パスワード / AWS キー**は、稼働確認後に**ローテーション**推奨。
- `admin_ssh_cidr` は自分の `/32` に固定。アプリの inbound ポートは**開けない**（long polling なので公開攻撃面ゼロ）。
- `memory_git_remote`（記憶のオフサイトバックアップ）は **private リポジトリ**を使う。

---

## 既知の TODO（v1 時点）

- 会話 → メモリの**自動書き込み**（`closeSession` の自動トリガ＝Step 3c）はまだ未配線。現状は「賢く応答するが、まだ自動では記憶しない」状態。
- Markdown に手で書いた記憶は `reindex --all` で TiDB に反映され、recall されます。
