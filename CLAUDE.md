# design-loop

ローカルWebサイトデザイン調整ツール。

## 開発

- ランタイム: Bun（必須）
- PTYには `Bun.Terminal` / `Bun.spawn` を使用（node-pty不要）
- それ以外のサーバAPIはNode.js互換（`node:http`, `node:net`, `node:fs`等）
- テスト: `bun test`
- ビルド: `bun run build`（サーバ: tsc, フロントエンド: bun build）

## コーディング規約

- TypeScript strict mode
- `type` を使う（`interface` は使わない）
- `!`（non-null assertion）は使わない
- `any` を避ける

## サーバのセキュリティ

- 全サーバは `127.0.0.1` にバインド
- WebSocket / APIエンドポイントで Origin ヘッダーを検証
