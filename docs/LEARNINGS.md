# SHIBA — 実装の知見・ハマり所ログ (engineering learnings)

実装中に**詰まった点・試して分かった事実**(ベンダー仕様の癖・IaC・API・ライブラリの罠)を1箇所に集約する。
目的は**同じ罠を二度踏まないこと**。設計判断は `docs/adr/`、これは「やってみて分かったこと」。

**1エントリの形式**:
- `### YYYY-MM-DD [領域] 一言タイトル`
- **試したこと / 状況** → **分かったこと** → **回避策・決定** → **出典/確認方法**(URL or 再現コマンド)
- 未確定は `⚠️ 未検証` と明記。確定したら印を消す。

---

## Infra / Terraform / クラウド

### 2026-06-13 [TiDB] 無料 Starter は `tidbcloud_serverless_cluster` で作れる・無料化は `spending_limit` を付けないこと
- **状況**: 「TiDBの無料枠を Terraform / AWS Marketplace から作れるか」を調査。
- **分かったこと**: PingCAP公式の `tidbcloud/tidbcloud` プロバイダに `tidbcloud_serverless_cluster` リソースがある(v0.4.0以降。旧 `tidbcloud_cluster` は deprecated)。必須引数は `display_name` と `region = { name = "regions/{region-id}" }`。**`spending_limit` を省略すれば無料枠**(5GiB行+5GiB列+50M RU/月、組織あたり最大5クラスタ)。read-only で `endpoints.public.host/port`・`user_prefix`・`cluster_id` を出力。
- **決定**: `deploy/terraform/main.tf` で採用。`spending_limit` はコメントアウト。
- **出典**: [provider GitHub](https://github.com/tidbcloud/terraform-provider-tidbcloud) / [serverless_cluster docs](https://registry.terraform.io/providers/tidbcloud/tidbcloud/latest/docs/resources/serverless_cluster) / [Starter FAQ](https://docs.pingcap.com/tidbcloud/serverless-faqs/)。⚠️ 未検証: region-id が `aws-ap-northeast-1` で正しいか、プロバイダ経由で $0 のまま(手動承認なしで)作成できるか → 初回 `apply` で確認。

### 2026-06-13 [TiDB] serverless の SQL パスワードは Terraform で管理されない
- **状況**: クラスタ作成後すぐ `.env` に DSN を流し込んで起動したい。
- **分かったこと**: `tidbcloud_serverless_cluster` は `host/port/user_prefix` は出すが**パスワード引数・属性が無い**(旧 `tidbcloud_cluster` の `config.root_password` は廃止)。SQLユーザは `<user_prefix>.root`。
- **回避策**: 2段階。初回 `apply` でクラスタ作成 → コンソールでパスワード reset → `terraform.tfvars` の `tidb_password` に入れて再 `apply`。`user_data` は `tidb_password` が空なら `docker compose up` をスキップ(中途半端起動を防止)。
- **出典**: serverless_cluster スキーマに password 不在を確認。`deploy/terraform/README.md` Gotcha A。

### 2026-06-13 [TiDB] auto-embed に「キー不要の無料モデル」がある(`tidbcloud_free/...`)→ PoCはBYOK設定不要
- **状況**: 「Gemini キーを TiDB のどこに設定するか分からない」が PoC のブロッカーだった。
- **分かったこと**: TiDB auto-embedding には **`tidbcloud_free/amazon/titan-embed-text-v2`(1024次元・APIキー不要・マネージド)** がある。`EMBED_TEXT('tidbcloud_free/amazon/titan-embed-text-v2', col)` の GENERATED 列で即使える。`VECTOR(N)` は**モデルの次元と一致必須**(Titan free=1024、Gemini=1536)。
- **BYOKのキー設定手順**: 公式docに明記が薄い(Pythonはprovider既定env var、SQL/コンソール手順は未明記)→ ⚠️ Gemini本番化の際に要確認(コンソールの Integrations / API Keys 系の見込み)。
- **決定**: **PoC は free Titan(キー不要)@1024 で開始**(`.env.example`/`db.ts`/`schema.sql`/`smoke.ts` の既定を変更、`EMBED_DIM` 導入)。本番の Gemini @1536(`91 §2.4-7`)は後で(モデル変更=全再embed、`94 A-3`)。
- **出典**: [Auto Embedding Overview](https://docs.pingcap.com/ai/vector-search-auto-embedding-overview/)(`tidbcloud_free/amazon/titan-embed-text-v2`、CREATE TABLE 例)。

### 2026-06-13 [TiDB] ★PoC実機検証(東京・無料Starter・1000 facts)= 「10x」entity-route は成立。大規模は join 順が課題
- **検証環境**: `OSS/shiba/poc/tidb/`。free Titan(1024次元)+ FTS(MULTILINGUAL)+ entity-route 1 SQL を東京 Starter で実測(Node22/mysql2)。
- **smoke 全PASS**: `EMBED_TEXT` auto-embed・`VEC_EMBED_COSINE_DISTANCE`・日本語 `FTS_MATCH_WORD`(MULTILINGUAL)が**東京の無料Starterで動く**。→ CJK FTS の手作り回避策(trigram/ILIKE)は不要。
- **レイテンシ(1000 facts, 30 reps)**: **entity-route(JOIN+vector)p50=18.9ms / p95=99ms** ✅。aggregate p50=14ms、1-hop p50=24ms、FTS p50=62ms、text-route vector p50=17ms。→ **101 の「1〜2クエリ・sub-second」は成立**(支配項は LLM 応答)。
- **⚠️ EXPLAIN の所見**: entity-route は **vector index 未使用 + `facts` フルスキャン駆動**。84件の部分集合に**ブルートフォース厳密距離**(個人規模では正しく速い=91 §2.0★1の想定どおり)。だが join 順が `facts` 全件→fact_entities probe で、本来は `fact_entities(entity_id)` から絞って facts を引きたい。原因は `stats:pseudo`(統計未取得)の見込み → **大規模では要 `ANALYZE TABLE` + join順確認**。
- **⚠️ クエリ側 auto-embed の尾**: `VEC_EMBED_COSINE_DISTANCE(col, 'query')` は**毎回 embed API を呼ぶ** → text-route vector p95=481ms の尾。recall では「クエリを一度 embed して使い回す/キャッシュ」を検討(本番 Gemini でも同様)。
- **書き込み**: 同期 per-row auto-embed(INSERT時)は **~4 facts/s**(Titan free・東京)。背景書き込みなので致命的でないが、**reindex/bulk はバッチ embed 必須**。RU は entity-route 1クエリ ≈ 71 RU → 50M RU/月は個人利用に十分。
- **再ベンチ追記(2026-06-13)**: 手動 `ANALYZE TABLE` は **Starter でハング**(下の別エントリ)→ 統計を強制収集できず、自動統計も効かず **plan は `stats:pseudo` のまま**(entity-route は依然 `facts` フルスキャン駆動 → fact_entities を probe)。**latency は不変で良好**(entity-route p50 17ms / p95 96ms、RU≈71)。1000行では全件スキャンが ~5ms なので p95 を支配しない。
- **✅ スケール課題は解決(EXPLAIN確認、`explain.ts`)**: 書換 **`WHERE f.id IN (SELECT fact_id FROM fact_entities WHERE entity_id=?)`** は **`idx_fe_entity(entity_id)` 駆動**(該当 fact_id だけ IndexRangeScan → facts を PK で point fetch、**`facts` フルスキャン消滅**)= **スケールセーフ**。一方 `/*+ LEADING(fe,f) */` ヒントは効かず(facts 全件のまま)。`stats:pseudo` でも**クエリ形で良い経路に固定**できるのが要点。→ **アプリの entity-route はこの IN-subquery 形を正準採用**(元のJOIN形は使わない)。vector index は依然未使用=小部分集合の厳密距離(想定どおり)。
- **未確認(大規模で)**: 数万件での実測、text-route 全件 vector の HNSW index 起動、Gemini@1536 の品質差。
- **総合判定**: **核心仮説(entity-route の単一SQL filtered search)は実機で成立・個人規模 v1 は問題なし** → 設計続行。大規模 join 順は v1 出荷後に実データで詰める(または上記書換を先に採用)。

### 2026-06-13 [tooling] 素朴な「`;` 分割 + コメント行除外」は、コメント先頭の SQL 文を丸ごと落とす
- **症状**: `apply-schema.ts` が `facts` / `fact_entities` の CREATE をスキップ(コメント行が先頭に付く文が `s.startsWith("--")` で除外された)。
- **修正**: 先に**行コメントを除去してから** `;` で分割(`split("\n").filter(!startsWith("--")).join().split(";")`)。複数文SQLを雑に分割しない教訓。

### 2026-06-13 [TiDB] 手動 `ANALYZE TABLE` は Starter でハングする(統計は自動収集に任せる)
- **症状**: `ANALYZE TABLE facts` が返らずプロセスが刺さる(複数試行ぶん stack、pkill=exit 144 で終了)。EXPLAIN は `stats:pseudo` のままで join 順が最適化されない。
- **推測**: TiDB Cloud Serverless/Starter は統計を**バックグラウンドで自動収集**する設計で、手動 ANALYZE はブロック/キュー待ちになる(または小テーブルでは収集されない)。
- **回避**: 手動 ANALYZE に頼らない。join 順を制御したい時は**クエリ書換 / index hint**で対応し、大規模では自動統計に委ねて実測する。
- **PoCツール**: `analyze.ts` は使わない(ハング源)。`pnpm bench` 単独で回す。

### 2026-06-13 [AWS] 〔訂正済み〕Lightsail でもインスタンスにIAMロールを付けられる → キーレスBedrockは成立する
- **当初の誤り**: 「Lightsail は EC2 のような instance profile / IAM ロールを持てない → キーレスBedrock不可、SSM秘密取得も不可」と**一般知識から推測で断言**してしまった(docs/91 §3.0・terraform README・variables.tf にも反映してしまった)。
- **一次情報で訂正(オーナー指摘)**: AWS公式 OpenClaw blueprint のセットアップスクリプトは **`LightsailRoleFor-<instance-id>` というIAMロールを作り、インスタンスプロファイルとして割り当て**、Bedrock(+ AWS Marketplace)権限を付与する。**Lightsail はインスタンスにロールを付けられ、キーレスBedrock(およびロール経由のSSM取得)は成立する**。→ Gotcha B は撤回。
- **残る正確なニュアンス(IaC、⚠️未検証)**: blueprint はロール割り当てを **CloudShell の CLI スクリプト**で実施。`aws_lightsail_instance` が宣言的に instance profile を張れるかは未確認 → 張れなければ `null_resource` + `local-exec`(AWS CLI)で同等を実行する。
- **教訓**: **ベンダー仕様は一般知識で断言せず、必ず一次情報で確認する**。今回はオーナーが公式ブログを提示して誤りが判明した。`docs/91 §3.0`・terraform README・variables.tf を訂正済み。
- **出典**: [AWS blog](https://aws.amazon.com/jp/blogs/news/introducing-openclaw-on-amazon-lightsail-to-run-your-autonomous-private-ai-agents/) / [Lightsail OpenClaw quickstart](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-quick-start-guide-openclaw.html)(`LightsailRoleFor-<id>`、instance profile、CloudShellスクリプト)。

### 2026-06-13 [AWS] キーレスBedrockの実機構 = role-chaining(EC2 instance profileではない)+ plain instanceは要スパイク
- **分かったこと(クイックスタート精読)**: Lightsail は **`arn:aws:sts::<acct>:assumed-role/AmazonLightsailInstance/<instance-id>`** という基底identityで動き、IMDS(`169.254.169.254`)で公開。blueprint のスクリプトは `LightsailRoleFor-<id>`(trust=その基底identity、perm=`bedrock:InvokeModel(+Stream)` + `aws-marketplace:{Subscribe,Unsubscribe,ViewSubscriptions}`)を作り、箱の `~/.aws/config`(`role_arn` + `credential_source=Ec2InstanceMetadata`)で **SDKがそのロールをassume**。EC2 の instance profile とは別物の**ロールチェーン**。
- **SHIBAへの実装**: `deploy/terraform/bedrock.tf` に role+policy を作成(`model_provider="bedrock"` 既定)。IAM部分は確定。
- **⚠️ 未検証の鎖**: 上記は blueprint インスタンスでの話。**plain Ubuntu の Lightsail で IMDS が assume 可能な基底creds を出すか**は未確認 → README「Option B」の15分スパイク(`/latest/meta-data/iam/security-credentials/` が role 名を返すか)で確認してから依存。出さなければ `model_provider="anthropic"`(APIキー)に退避。
- **コンテナ資格情報**: app は Docker なので assume したcredsをコンテナに届ける必要(`~/.aws` をROマウント or IMDS直アクセス)→ compose 作成(Step 2)で確定。
- **別途1回**: Anthropic on Bedrock は **First Time Use フォーム**提出(コンソール、アカウント/org単位、IaC不可)。
- **出典**: [Lightsail OpenClaw quickstart](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-quick-start-guide-openclaw.html)(スナップショット復元FAQに IMDS コマンドと trust policy 編集手順)。

### 2026-06-13 [TiDB] AWS Marketplace は無料枠の導線ではない(請求統合用)
- **分かったこと**: AWS Marketplace の TiDB Cloud 出品(`prodview-7xendfnh6ykg2`)は**アカウント開設・請求統合**向け。無料 Starter を取るための専用導線ではなく、IaC を楽にもしない(クラスタ生成はどのみち TiDB Cloud API 経由)。
- **決定**: Marketplace は使わず `tidbcloud` プロバイダを直接使う。
- **出典**: [AWS Marketplace: TiDB Cloud](https://aws.amazon.com/marketplace/pp/prodview-7xendfnh6ykg2) / [create-serverless docs](https://docs.pingcap.com/tidbcloud/create-tidb-cluster-serverless/)。

### 2026-06-13 [AWS] Lightsail の sizing/blueprint と long polling によるポート設計
- **分かったこと**: `aws_lightsail_instance` 必須= `availability_zone`/`blueprint_id`/`bundle_id`/`name`。**4GB = `bundle_id = "medium_3_0"`**、**Ubuntu 22.04 = `blueprint_id = "ubuntu_22_04"`**、AZ 例 `ap-northeast-1a`。`user_data` は単一行寄り(複数行スクリプトは実用上動くが注意)。export は `public_ip_address`/`username` 等。
- **決定**: Telegram は **long polling = inbound 不要** → `aws_lightsail_instance_public_ports` を **SSH(22)だけ**にして 80/443 を閉じる(既定で開くため明示的に塞ぐ=公開攻撃面ゼロ、`docs/98 §1.2`)。静的IPも不要(webhook を使う時だけ)。
- **出典**: [aws_lightsail_instance](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/lightsail_instance) / [Lightsail TF blog](https://oneuptime.com/blog/post/2026-02-12-create-lightsail-instances-terraform/view)。

### 2026-06-13 [運用] Terraform Registry のページは JS 描画で WebFetch が空になる
- **分かったこと**: `registry.terraform.io/.../docs/resources/...` は動的描画で本文が取れない。プロバイダの doc は **`raw.githubusercontent.com/<org>/terraform-provider-*/<branch>/docs/resources/*.md`** や AWS の `website/docs/r/*.html.markdown` を生Markdownで取ると確実。
- **回避策**: スキーマ確認は raw GitHub を一次ソースにする。

### 2026-06-13 [terraform] `templatefile()` はコメント内の `${...}` も補間する(validateで検出)
- **症状**: `terraform validate` が `user_data.sh.tftpl` の**コメント行のリテラル `${...}`** を補間式と解釈し "Invalid expression" で失敗。
- **修正**: リテラルの `${` は `$${` でエスケープ(または文言から除去)。bash の `$(...)` / `$VAR`(波括弧なし)は templatefile が触らないので安全。`.env` heredoc は `<<'ENVEOF'`(quoted)にしてレンダ後の bash 再展開も防止。
- **検証フロー確定**: `terraform fmt` だけでは不十分。**`init` → `validate`(プロバイダ実スキーマで参照/属性/型を検証・資格情報不要)→ `terraform test`(mock_provider で plan時ロジック)**。aws 6.50.0 / tidbcloud 0.4.10 で validate 通過・test 3件 pass(Bedrock count-gate / SSHのみ / provider validation)。`.terraform.lock.hcl` はコミットする(.gitignoreから除外)。
- **未検証**: 実 `plan`/`apply`(要 AWS+TiDB 資格情報)= region_id 妥当性・無料枠 provisioning・IMDS Bedrock チェーンは実環境でのみ確認可。

### 2026-06-13 [AWS/deploy] ★keyless Bedrock は Lightsail + 宣言的Terraform では作れない(apply で IAM 拒否)
- **症状**: `terraform apply` で `aws_iam_role.bedrock` が `MalformedPolicyDocument: Invalid principal: arn:aws:sts::ACCT:assumed-role/AmazonLightsailInstance/*`。
- **原因**: ① assumed-role principal に**ワイルドカード `*` は不可** ② `AmazonLightsailInstance` は**単体IAMロールとして存在しない**(`aws iam get-role`=NoSuchEntity)。これはSTSセッション名で、trust できるのは `arn:aws:sts::ACCT:assumed-role/AmazonLightsailInstance/<instance-id>`(**具体的 instance-id**=作成後にしか分からない)。実際この口座には過去 blueprint の `LightsailRoleFor-i-090b2dfe...` が残存。
- **構造的結論**: keyless Bedrock は **OpenClaw blueprint方式**(インスタンス作成→IMDSで instance-id 取得→その id 専用ロールを CloudShell スクリプトで作成)前提。**平の Ubuntu Lightsail + 宣言的 Terraform では成立しない**(chicken-egg + principal 検証 + そもそも平箱が IMDS creds を出すか不明)。`#3/#4` の配線は blueprint 前提なら動くが、素の箱では不可。
- **`terraform test`(mock)が見逃した理由**: mock_provider は IAMポリシーの**意味検証をしない** → 作成testは通ったが実IAMは拒否。**plan/test では IAM principal 妥当性は分からない**(実apply or policy simulator が要る)。
- **決定**: Lightsail デプロイは **`model_provider=anthropic`(APIキー)** を採用(=ずっと「確実な道」と言ってきた通り)。Bedrock化は将来 OpenClaw blueprint をベースイメージにする等の別アプローチ。
- **state**: TiDBクラスタ + key_pair は作成成功・state 記録済み(再applyで重複しない)。失敗した IAMロール/instance は未作成。TiDB の "inconsistent result"(auto_scaling=null→{0,0})は provider v0.4.10 のバグ → `lifecycle { ignore_changes = [auto_scaling] }` で抑止。

### 2026-06-13 [AWS/deploy] ★★keyless Bedrock は平の Lightsail 箱では原理的に不可能(実機で確定)
- 手動で role を作り trust を正しい principal に直しても **`AccessDenied: ...AmazonLightsailInstanceRole/i-... is not authorized to perform sts:AssumeRole on ...shiba-bedrock`**。
- **根因**: 箱の IMDS identity は AWS の口座 `437521954154` の `AmazonLightsailInstanceRole`。クロスアカウント AssumeRole は**相手側(AWS)の identity ポリシー許可も必須**だが、それは顧客が付与できない。OpenClaw blueprint 箱だけが特別連携(annotation `DELEGATE_USER`、role名も `AmazonLightsailInstance`)で例外的に可能。
- **IMDSスパイクの落とし穴**: `iam/security-credentials/` は role 名を**返す**(=一見chainable)が、その identity は**顧客ロールを assume できない**。「creds が見える」≠「assume できる」。**invoke/assume を実際に叩くまで分からない**。
- **結論(確定)**: 平の Ubuntu Lightsail で **keyless Bedrock(role-chaining)は不可**。Bedrock を使うなら **IAMユーザのアクセスキーを箱に置く**(keyless ではないが機能・AWS課金一本化は維持)か、Anthropic APIキー。OpenClaw blueprint をベースにする手もあるが大改修。
- 作った `shiba-bedrock` ロールは無効(削除可)。`manage_bedrock_role=false` のまま。

### 2026-06-13 [Telegram] BotFather に Terraform は無い
- **分かったこと**: bot 作成・token 取得は対話式の BotFather のみ。IaC 化不可。
- **決定**: token は `apply` 前の手動前提条件。`terraform.tfvars` の入力にする。「完全ワンコマンド」にはならない正直な制約。

---

## Core / アプリ実装

### 2026-06-13 [schema] facts/entities の id は app割当(AUTO_RANDOM不使用)、chunks のみ AUTO_RANDOM
- **決定**: `facts.id` / `entities.id` を `BIGINT PRIMARY KEY`(reindex/extract が採番)に。理由: ① `fact_entities` が両者を参照=リンクに安定idが要る ② AUTO_RANDOM 生成idは JS safe-int 超で precision 崩れ(PoC seeder の教訓) ③ AUTO_RANDOM への明示INSERTは要フラグで面倒。`chunks.id` は誰も参照しないので AUTO_RANDOM 維持。
- **影響**: `docs/91 §2.2`(facts/entities が AUTO_RANDOM)とズレ → 実装に合わせ 91 を後で更新(TODO)。`reindex --all` は app採番(i+1)で TRUNCATE→再INSERT(`src/index/reindex.ts` `buildIndexRecords`=純・テスト済、entity dedupe + 繋がり materialize)。

### 2026-06-13 [llm] Bedrock LLM クライアント実装(#3)+ ロール資格情報の箱配線(#4)
- **#3**: `@anthropic-ai/bedrock-sdk` の `AnthropicBedrock`(`.messages.create` は core SDK と同形)で `BedrockLlm` を実装。2 SDK のレスポンス型差は **構造的型 `ContentResponse`**(`{content:[{type,text?}]}`)で吸収=union 呼び出し問題を回避。AWS資格情報は **ローカル=`aws sso login` / 箱=IMDSロール**で同一コード。Bedrockモデルid(inference profile)は region/account 依存なので **env 必須・推測しない**(未設定なら getLlm が明示エラー)。
- **#4**: Terraform が user_data で `~/.aws/config`(`role_arn` + `credential_source=Ec2InstanceMetadata`)を書き、`compose.yml` が container にROマウント=**role-chaining**(EC2 instance profile ではない)。`bedrock_response_model`/`extract_model` を `.env` に流す。**残る未検証は IMDSチェーン(箱でのスパイク)+ FTUフォーム1回**。
- **⚠️ `terraform test` が検出した罠**: `coalesce(one(list),"")` は **空文字も除外**するため count=0 で「全引数 null/空」エラー。null→"" の既定化は **`join("", list[*].attr)`** を使う。**`validate` は通るが `test`(=plan)で発覚** → terraform は validate だけでなく test まで回す。
- **3b の検証方針**: 外部I/O(LLM/Telegram)は注入依存にし fake で単体テスト(extract parse/clamp・allowlist・turn-loop orchestration = +9テスト、計27)、SDK配線(@anthropic-ai/sdk 0.104.1 / grammy 1.43.0)は typecheck で検証。live 実行は鍵が要るので deploy 時。「動かせないコードを積まない」= ロジックは全部 fake で回る。

### 2026-06-13 [memory] facts fence 形式を確定(round-trip 可能・人間可読)
- ` ```facts v1 ` ブロック内に `- [kind] claim @slug ^YYYY-MM-DD !untrusted`、`~~...~~`=superseded(忘却)。`parseFacts`⇄`serializeFactsBlock` が round-trip(テスト済)。`@slug`=entity(101の繋がりはここに人間が書ける)、`!untrusted`=source_trust(98 §3.5)。真実は Markdown、TiDB は派生。
