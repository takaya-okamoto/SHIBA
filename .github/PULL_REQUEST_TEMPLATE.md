## 概要


## 変更内容


## チェックリスト
- [ ] `pnpm typecheck && pnpm lint && pnpm test` が通る
- [ ] 外部 I/O は注入依存のままで、fake で単体テストできる
- [ ] セキュリティ境界（`source_trust` / アクセス境界 / 「v1 は行動しない」）を壊していない
- [ ] 必要なら `CHANGELOG.md` / ドキュメントを更新した
