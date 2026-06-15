# コントリビューションガイド

SHIBA への貢献を歓迎します。個人開発中の OSS（Apache-2.0）です。

## 開発環境

- **言語 / ランタイム**: TypeScript + Node.js 22 LTS
- **パッケージマネージャ**: pnpm（`package.json` の `packageManager` で `pnpm@10.15.0` に固定）
- **Lint / Format**: Biome
- **テスト**: vitest

```bash
corepack enable
pnpm install
pnpm typecheck   # tsc --noEmit
pnpm lint        # biome check
pnpm test        # vitest
pnpm build       # tsc
```

## 貢献の流れ（fork → PR）

外部コントリビュータは `main` への直接 push 権限を持ちません。以下の fork ベースで進めます。

1. このリポジトリを **fork**（右上の Fork ボタン）。
2. fork を clone し、feature ブランチを切る:
   ```bash
   git clone git@github.com:<you>/SHIBA.git
   cd SHIBA
   git checkout -b fix/<short-topic>
   ```
3. 変更し、`pnpm typecheck && pnpm lint && pnpm test` が green であることを確認。
4. push して、**自分の fork から `takaya-okamoto/SHIBA` の `main` に向けて PR** を作成。
5. CI（typecheck / lint / test / build）が green になり、レビューが承認されるとマージされます。

`main` は保護されており、**PR 経由かつ CI green でないとマージできません**（マージはメンテナが行います）。
`CODEOWNERS` に該当するパスを変更した場合は、コードオーナーのレビューが自動でリクエストされます。

## 規約

- **言語**: ソースコード・コメント・コミットメッセージ・issue / PR は**英語**で書きます
  （ドキュメントには日本語のものもあります）。
- **コミット**: 簡潔な命令形（例: `fix(migrate): strip inline comments`）。
- **PR**: 小さく焦点を絞る。`pnpm typecheck && pnpm lint && pnpm test` が通ること。
  外部 I/O（LLM / Telegram）は**注入依存**にして fake で単体テストできる形を保つ
  （「動かせないコードを積まない」）。
- **セキュリティ**に関わる変更は `SECURITY.md` の設計境界を壊さないこと
  （特に `source_trust`・アクセス境界・「v1 は行動しない」）。

## ブランチ / リリース

- `main` が開発の最新。機能は feature ブランチ → PR。
- ユーザーから見える変更は `CHANGELOG.md` に1行追記。

## 困ったら

- バグ報告・機能提案は issue テンプレートから。脆弱性は `SECURITY.md` の手順で**非公開**報告。
