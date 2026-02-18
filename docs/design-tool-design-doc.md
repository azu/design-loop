# Design Doc: design-loop — ローカルWebサイトデザイン調整ツール

## 概要

デザイナーが、ローカルで動作しているNext.js / React / Panda CSSサイトの見た目を、プロンプトで直接調整できるCLIツール。プレビューで要素を選択し、自然言語で「角丸を大きくして」「余白を詰めて」と指示するだけで、ソースコードが自動的に編集される。変更はGitのPRとしてエンジニアに渡せる。デザイナーはGitを意識しない。

## 背景と動機

現状、デザイナーがWebサイトのデザインを微調整するフローには課題がある。Figmaでデザインを修正してエンジニアに伝える方法では、実際のコードとの乖離が生まれやすい。Chrome DevToolsで直接CSSをいじる方法では、変更がコードに反映されず消えてしまう。

このツールは「実際に動いているサイト」を見ながら「実際のコードを編集する」という体験を、デザイナーがGitやコードエディタを使わずに実現する。バックエンドにはClaude Code CLIをそのまま使い、ターミナルUIをブラウザ上に表示する。

## ターゲットユーザー

Next.js + React + Panda CSSで構築されたWebサイトのデザインを調整するデザイナー。エンジニアリングの知識は前提としない。Git、ターミナル、コードエディタの操作は不要。

## 使い方

```bash
npx design-loop run \
  --url="http://localhost:3000" \
  --command="pnpm run dev" \
  --source="./my-app"
```

CLIを実行すると、ブラウザが自動的に開き、左右分割の画面が表示される。左側にサイトのプレビュー、右側にClaude Codeのターミナル。デザイナーは左側で要素をクリックし、右側のターミナルに表示されたコンテキスト情報に続けて指示を入力する。

## アーキテクチャ

### 全体構成

CLIが4つのサーバを起動し、ブラウザで1つのURLを開くだけのシンプルな構成。Electronなどのネイティブアプリは使わず、npmパッケージとして配布する。

```
design-loop CLI
│
├── [1] Dev Server（子プロセス）
│   └── pnpm run dev → http://localhost:3000
│
├── [2] MITMプロキシサーバ（port 3001）
│   ├── Dev Serverへのリクエストを中継
│   ├── HTMLレスポンスに要素選択スクリプトを注入
│   ├── X-Frame-Options / CSP ヘッダーを除去
│   ├── Accept-Encoding を外して非圧縮レスポンスを取得
│   └── WebSocket（HMR）を透過的に中継
│
├── [3] PTY WebSocketサーバ（port 3002）
│   ├── node-pty で claude コマンドを起動
│   └── WebSocket経由でターミナル入出力を中継
│
└── [4] ツールUIサーバ（port 3003）← ブラウザでここを開く
    └── 単一のHTML
        ├── 左ペイン: iframe（プロキシ経由のプレビュー）
        └── 右ペイン: ghostty-web ターミナル ↔ WebSocket ↔ PTY
```

### なぜこの構成か

**Electronを使わない理由:** 配布が面倒になる。Chromiumをバンドルするのでサイズが大きくなる。デザイナーの環境にnpm（またはnpx）さえあれば動く方が導入ハードルが低い。

**ローカルMITMプロキシを使う理由:** Dev Serverのコードを一切変更せずに、プレビューページにスクリプトを注入できる。iframeで表示する際に問題になるヘッダーもプロキシ側で処理できる。ローカルHTTP通信なのでSSLの問題がない。

**ghostty-webを使う理由:** Claude Code CLIのターミナルUIをブラウザ上にそのまま再現できる。xterm.jsと互換のAPIを持ちつつ、GhosttyのネイティブVT実装をWASMで動かすので描画品質が高い。バンドルサイズは約400KBで、Webアプリとして問題にならない。

### コンポーネント詳細

#### MITMプロキシサーバ

Node.jsの `http.createServer` でプロキシサーバを構築し、HTML変換には `htmlrewriter`（Cloudflareの `lol-html` のWASM版、 https://www.npmjs.com/package/htmlrewriter ）を使う。外部のプロキシライブラリ（`http-proxy` など）は使わない。

`lol-html` はCloudflare Workersで使われているRust製のストリーミングHTMLパーサー/リライターで、CSSセレクタベースのAPIでHTML要素を操作できる。レスポンス全体をバッファリングせずストリーミングで変換するため、正規表現で `</body>` を置換する方式より堅牢かつ効率的。

```javascript
// 概念的なコード
import http from 'node:http';
import { HTMLRewriter } from 'htmlrewriter';

const UPSTREAM = 'http://localhost:3000';

http.createServer(async (req, res) => {
  const upstreamUrl = new URL(req.url, UPSTREAM);
  const upstream = await fetch(upstreamUrl, {
    method: req.method,
    headers: req.headers,
  });

  // X-Frame-Options / CSP を除去してiframe表示を許可
  const headers = new Headers(upstream.headers);
  headers.delete('x-frame-options');
  headers.delete('content-security-policy');

  if (upstream.headers.get('content-type')?.includes('text/html')) {
    // HTMLRewriterでストリーミング変換、bodyの末尾にスクリプトを注入
    const rewritten = new HTMLRewriter()
      .on('body', {
        element(el) {
          el.append(
            '<script src="/design-loop-inject.js"></script>',
            { html: true }
          );
        }
      })
      .transform(new Response(upstream.body, { headers }));

    res.writeHead(200, Object.fromEntries(rewritten.headers));
    const reader = rewritten.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
  } else {
    // HTML以外はそのまま中継
    res.writeHead(upstream.status, Object.fromEntries(headers));
    const reader = upstream.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
  }
}).listen(3001);
```

HMR用のWebSocket中継は `http.createServer` の `upgrade` イベントで処理する。WebSocketフレームはHTMLではないのでHTMLRewriterを通す必要がなく、ソケット同士を素朴にpipeするだけで済む。

```javascript
// WebSocket透過中継（概念的なコード）
import { createConnection } from 'node:net';

server.on('upgrade', (req, socket, head) => {
  const upstream = createConnection({ host: 'localhost', port: 3000 });
  // HTTPアップグレードリクエストをそのまま転送
  upstream.write(
    `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n` +
    Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n') +
    '\r\n\r\n'
  );
  upstream.write(head);
  // 双方向にpipe
  socket.pipe(upstream);
  upstream.pipe(socket);
});
```

注入するスクリプトの役割は3つある。hover時に要素をハイライト表示すること。クリックで要素を選択し、React Fiberからコンポーネント名・ファイルパスを取得し、computed stylesを収集すること。収集した情報を `window.parent.postMessage()` で親フレーム（ツールUI）に送信すること。

#### 要素選択スクリプト（プレビュー側に注入）

```javascript
// 概念的なコード
document.addEventListener('mouseover', (e) => {
  // ハイライト表示（overlay要素をposition: absoluteで配置）
  highlightElement(e.target);
});

document.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();

  const info = {
    // CSSセレクタ
    selector: getCSSSelector(e.target),
    // React Fiberからコンポーネント情報を取得
    component: getReactComponentInfo(e.target),
    // computed styles
    styles: getComputedStylesSummary(e.target),
    // bounding box（スクリーンショットクロップ用）
    rect: e.target.getBoundingClientRect(),
  };

  window.parent.postMessage({ type: 'element-selected', payload: info }, '*');
});
```

**React Fiberからの情報取得:**

React 18+のdev modeでは、DOM要素に `__reactFiber$` プレフィックスのプロパティが付与される。このFiberノードを辿ることで、コンポーネント名を取得できる。ファイルパスは `fiber._debugSource` から取得できる（dev modeのみ）。

```javascript
function getReactComponentInfo(element) {
  const fiberKey = Object.keys(element).find(k => k.startsWith('__reactFiber$'));
  if (!fiberKey) return null;

  let fiber = element[fiberKey];
  // ネイティブ要素からコンポーネントFiberまで遡る
  while (fiber && typeof fiber.type === 'string') {
    fiber = fiber.return;
  }

  return {
    name: fiber?.type?.displayName || fiber?.type?.name || 'Unknown',
    source: fiber?._debugSource, // { fileName, lineNumber, columnNumber }
  };
}
```

**Panda CSSのスタイル情報:**

Panda CSSはビルド時にユーティリティクラスを生成するため、computed stylesの生の値（`padding: 8px`、`border-radius: 4px` など）をそのまま渡す。Claude Codeがコードベースの `panda.config.ts` を参照して、適切なトークン（`p="2"`、`rounded="md"` など）に変換する。

#### PTY WebSocketサーバ

`node-pty` でClaude Code CLIを起動し、 `ws` パッケージでWebSocket経由でターミナルの入出力を中継する。

```javascript
// 概念的なコード
const pty = require('node-pty');
const WebSocket = require('ws');

const shell = pty.spawn('claude', [], {
  cwd: sourceDir, // --source で指定されたディレクトリ
  env: process.env,
});

const wss = new WebSocket.Server({ port: 3002 });
wss.on('connection', (ws) => {
  shell.onData((data) => ws.send(data));
  ws.on('message', (data) => shell.write(data.toString()));
});
```

#### ツールUI

フレームワークは使わない。素のHTML + TypeScript + CSSで構成する。管理するステートは「選択モードON/OFF」「選択中の要素情報」「左右の幅比率」程度で、ReactやVueを入れるほどの複雑さがない。

フロントエンド側のTypeScript（ghostty-webのimport含む）は `bun build` でバンドルする。Bunを開発ランタイムとして既に使っているので、esbuildやwebpackなど別のバンドラーを追加する必要がない。

```bash
# フロントエンドのビルド
bun build src/ui/index.ts \
  --outdir dist/ui \
  --target browser \
  --format esm \
  --minify \
  --splitting

# 開発時（ファイル変更を監視して自動リビルド）
bun build src/ui/index.ts \
  --outdir dist/ui \
  --target browser \
  --format esm \
  --watch
```

出力は静的なJS/CSSファイルで、ツールUIサーバが配信する。HTMLはエントリポイントとなる1ファイルのみで、`<script type="module">` でバンドル済みのJSを読み込む。

左ペインにプロキシ経由のプレビュー（iframe）、右ペインにghostty-webターミナルを配置する。

**レイアウト調整:**

左右ペインの境界にドラッグ可能なリサイズハンドルを配置する。デザイナーはマウスドラッグで左右の幅比率を自由に変更できる。デフォルトは50:50だが、プレビューを広く使いたい場合は70:30や80:20に調整できる。幅の比率はlocalStorageに保存し、次回起動時に復元する。

**Document Picture-in-Picture（PiP）:**

右ペインのターミナル部分をDocument Picture-in-Picture APIで別ウィンドウとして切り離せるようにする。これにより、プレビューをブラウザの全幅で表示しつつ、ターミナルを小さなフローティングウィンドウとして画面の端に置ける。デザイナーがプレビューに集中したいときに便利。

Document Picture-in-Picture APIはChrome 116以降で利用可能（ https://developer.chrome.com/docs/web-platform/document-picture-in-picture ）。通常の動画PiPと異なり、任意のHTML要素（この場合ghostty-webターミナル）をPiPウィンドウに移動できる。PiPウィンドウを閉じると、ターミナルは元の右ペインに戻る。

```javascript
// 概念的なコード
async function detachTerminal() {
  const pipWindow = await documentPictureInPicture.requestWindow({
    width: 480,
    height: 360,
  });
  // スタイルシートをコピー
  for (const sheet of document.styleSheets) {
    const style = document.createElement('style');
    style.textContent = [...sheet.cssRules].map(r => r.cssText).join('');
    pipWindow.document.head.appendChild(style);
  }
  // ターミナル要素をPiPウィンドウに移動
  pipWindow.document.body.appendChild(terminalContainer);
  // PiPが閉じられたら元に戻す
  pipWindow.addEventListener('pagehide', () => {
    rightPane.appendChild(terminalContainer);
  });
}
```

右ペインのヘッダーに「切り離す」ボタンを配置し、クリックでPiPモードに移行する。PiP未対応のブラウザではボタンを非表示にする。

**要素選択時の流れ:**

1. 左ペインのiframe内で要素がクリックされる
2. 注入スクリプトが `postMessage` でコンテキスト情報を送信
3. 親フレームがメッセージを受信
4. コンテキスト情報をフォーマットし、右ペインのターミナル上部にコンテキストバーとして表示（例: `📍 Header.tsx > .btn-primary | padding: 8px 16px, border-radius: 4px`）
5. デザイナーがターミナルに指示を入力すると、コンテキスト情報がプレフィックスとして自動付与される
6. Claude Codeがコードを編集 → Dev ServerのHMRで左ペインが自動更新

### ポート管理

すべてのポートは起動時に空きポートを自動検出する。`--url` で指定されたDev ServerのURLのポートのみ固定。

## プロジェクト設定ファイル

プロジェクトのルートに `.design-loop.json`（または `.design-loop.yml`）を置くことで、プロジェクト固有のコンテキストやツールの挙動をカスタマイズできる。

```json
{
  "context": {
    "files": [
      "panda.config.ts",
      "src/theme/tokens.ts",
      "src/theme/recipes.ts"
    ],
    "instructions": "Panda CSSのトークンを使ってスタイルを記述すること。インラインスタイルやCSS modulesは使わない。色はcolors.xxxを、スペーシングはspacing.xxxを使うこと。"
  },
  "devServer": {
    "command": "pnpm run dev",
    "url": "http://localhost:3000",
    "readyPattern": "Ready on"
  },
  "elementSelection": {
    "framework": "react",
    "ignoreSelectors": [".devtools-overlay", "[data-nextjs-dialog]"]
  }
}
```

**`context.files`** にはClaude Codeに常に認識させたいファイルのパスを列挙する。design-loop起動時にこれらのファイルをClaude Codeの初期プロンプトとして渡す。Panda CSSの `panda.config.ts` を指定しておけば、デザイナーが「青を少し明るく」と指示したときにClaude Codeがトークン定義を参照して `colors.blue.400` を `colors.blue.300` に変更する、といった正確な編集ができる。

**`context.instructions`** にはプロジェクト固有のルールやコーディング規約を自然言語で記述する。Claude Codeの `CLAUDE.md` と似た役割だが、design-loop用に特化した指示を書ける。たとえば「Panda CSSのトークンを使うこと」「コンポーネントは `src/components/` 以下に置くこと」「Tailwindは使わないこと」など。

**`devServer`** にはDev Serverの起動コマンドとURLを記述する。CLIの `--command` と `--url` オプションの代わりとして機能し、設定ファイルに書いておけばデザイナーは `npx design-loop run` だけで起動できる。 `readyPattern` はDev Serverの標準出力を監視し、このパターンにマッチしたらサーバの準備完了と判断してブラウザを開く。

**`elementSelection`** には要素選択の挙動を制御する設定を記述する。 `framework` でReact Fiber以外のフレームワーク（将来のVue/Svelte対応時）を指定できる。 `ignoreSelectors` で選択対象から除外するセレクタを指定できる（Next.jsのエラーオーバーレイなど）。

この設定ファイルはClaude Codeの `CLAUDE.md` と共存する。 `CLAUDE.md` はエンジニア向けの汎用的なプロジェクト設定で、 `.design-loop.json` はデザイナー向けのdesign-loop固有の設定という棲み分け。

## 要素選択 → Claude Codeへの入力

デザイナーが要素を選択した状態でターミナルに「角丸を大きくして」と入力すると、実際にClaude Codeに送られるプロンプトは以下のようになる。

```
[コンテキスト]
選択要素: <button> in Header コンポーネント (src/components/Header.tsx:24)
現在のスタイル: padding: 8px 16px, border-radius: 4px, background: blue.500, color: white
CSSセレクタ: .btn-primary

[指示]
角丸を大きくして
```

コンテキスト情報はPTYへの `write()` で自動入力される方法と、ターミナル上部のコンテキストバーに表示しつつClaude Codeへの入力時にシステムプロンプト的に付与する方法の2つが考えられる。前者はシンプルだがターミナルが汚れる。後者はUXが良いがClaude Code CLIの入力に介入する仕組みが必要。

プロトタイプでは前者（PTYへの直接書き込み）を採用し、改善の余地があれば後者に移行する。

## Git連携（デザイナーから見えない部分）

ツール起動時に、内部的に以下を行う。

1. 現在のブランチを記録
2. `design-loop/YYYY-MM-DD-HHMMSS` という作業ブランチを自動作成
3. Claude Codeがコードを編集するたびに、自動的にコミットされる（Claude Code自体のgit機能を利用）
4. デザイナーが「エンジニアに送る」ボタンを押すと、作業ブランチをpushしてPRを作成
5. PRの説明には、変更のビジュアルdiff（Before/Afterスクリーンショット）を含める

デザイナーに見えるUIは「元に戻す」「やり直す」「エンジニアに送る」の3ボタンのみ。

## 技術スタック

| コンポーネント | 技術 | 理由 |
|---|---|---|
| 開発ランタイム/バンドラー | Bun | TypeScript直接実行、テスト、フロントエンドバンドル、開発時のDX |
| 配布ランタイム | Node.js（互換） | npm/npx配布、幅広い環境で動作 |
| 言語 | TypeScript | 型安全、コードの明確さ |
| ツールUI | 素のHTML + TypeScript + CSS（フレームワークなし） | ステートが少なく、React/Vueはオーバーキル |
| プロキシ | Node.js標準 `http` + `htmlrewriter`（lol-html WASM） | 外部プロキシライブラリ不要、ストリーミングHTML変換 |
| PTY | node-pty | ターミナルエミュレーションの標準 |
| ターミナルUI | ghostty-web | xterm.js互換API、Ghosttyネイティブ実装のWASM版、高品質描画 |
| AI | Claude Code CLI | そのまま利用、追加開発不要 |
| 対象フレームワーク | Next.js + React + Panda CSS | 初期スコープ |

### 開発方針

開発にはBunを使い、TypeScriptを直接実行する。ただしBun固有のAPI（`Bun.serve()`、`Bun.file()` など）は使わず、Node.js互換のAPIのみで実装する。これにより、`npm` / `npx` で配布したときにNode.js環境でもそのまま動作する。

ビルドは2段階。サーバ側（CLI本体）は `tsc` でトランスパイルし、`package.json` の `bin` フィールドでCLIエントリポイントを指定する。フロント側（ツールUI）は `bun build --target browser` でバンドルし、静的ファイルとして配信する。Bunを開発ランタイム兼バンドラーとして使うことで、esbuildやwebpackなどの追加依存が不要。

ユーザーは `npx design-loop run` でNode.js環境で実行できる。Bunがインストールされている環境では `bunx design-loop run` でも動作し、起動が速くなる。

テストはBunの組み込みテストランナー（`bun test`）を使う。

### コード品質ツール

lint、format、型チェックにはoxcエコシステム（ https://oxc.rs/ ）と `@typescript/native-preview`（tsgo）を使う。ESLint + Prettier + tscの組み合わせをすべてRust/Go製のツールで置き換え、CIと開発時のフィードバックを高速化する。

**oxlint** — v1.0安定版リリース済みで、ESLintの50〜100倍速い（ https://voidzero.dev/posts/announcing-oxlint-1-stable ）。設定なしでも動くが、`.oxlintrc.json` または `oxlint.config.ts` でカスタマイズ可能。

**oxlint --type-aware** — 型情報を使ったlinting（未処理のPromise検出など）。内部的に `@typescript/native-preview`（tsgo、Microsoft公式のTypeScriptコンパイラGoポート）の型解析を利用する。DRESS CODEの事例（ https://zenn.dev/dress_code/articles/d655cd7a43b936 ）ではバックエンドのlint時間が92%削減（52→4秒）、型チェックが65%削減（105→36秒）という結果が出ている。

**oxfmt** — Prettierの代替フォーマッタ。oxcエコシステムの一部。

**@typescript/native-preview** — `tsc` の代替として型チェックに使う。Goポートのためtscよりはるかに高速。

```bash
# lint（type-aware有効）
oxlint --type-aware .

# format
oxfmt .

# 型チェック
tsgo --noEmit
```

CIおよびpre-commitフックで `oxlint --type-aware`、`oxfmt --check`、`tsgo --noEmit` を実行する。ビルド時のトランスパイルは引き続き `tsc`（または `tsgo` が安定したら置き換え）を使う。

## npmパッケージ依存

```json
{
  "dependencies": {
    "ghostty-web": "latest",
    "node-pty": "latest",
    "htmlrewriter": "latest",
    "ws": "latest",
    "open": "latest"
  },
  "devDependencies": {
    "@types/node": "latest",
    "@types/ws": "latest",
    "typescript": "latest",
    "@typescript/native-preview": "latest",
    "oxlint": "latest",
    "oxfmt": "latest"
  }
}
```

## IME対応（日本語入力）

デザイナーが日本語でプロンプトを入力するため、ghostty-webでのIME対応は必須要件。

ghostty-webはIME入力をサポートしている（ https://github.com/coder/ghostty-web/pull/90 で追加済み）。ただしClaude Code CLIのTUIはInk（React）ベースで、ターミナルの実カーソル位置を隠してANSIスタイルで視覚的なカーソルを描画するため、IME候補ウィンドウがカーソル位置ではなく画面の左下に表示されるという既知の問題がある（ https://github.com/anthropics/claude-code/issues/19207 ）。

この問題への対策は2つ考えられる。ひとつはClaude Code側のIMEカーソル位置の修正を待つ方法。もうひとつはツールUI側でIME入力用の独自テキストエリアを用意し、確定後にPTYに書き込む方法。後者はClaude Code CLIの体験を損なうが、日本語入力の実用性は確保できる。プロトタイプでは後者を選択肢として持ちつつ、まずはghostty-webのIMEサポートでどこまで使えるか検証する。

## 画像入力

デザインツールとして、参考画像やスクリーンショットをClaude Codeに渡したい場面は多い。「このデザインカンプに合わせて」「ここの余白をこの参考サイトと同じにして」といった指示には、画像が不可欠になる。

ただし、ghostty-web（ブラウザ上のターミナル）経由で画像を渡すのは仕組み上の制約がある。ネイティブターミナルではファイルをドラッグ＆ドロップするとファイルパスがテキストとして入力されるが、ブラウザのセキュリティモデルではローカルファイルパスを取得できない。ブラウザのドロップイベントで得られるのは `File` オブジェクト（Blob）であり、PTYに流せるテキストパスにはならない。

**対策: ツールUI側で画像アップロードUIを提供する。** ドロップされた画像をツールUIサーバのHTTP APIで受け取り、ソースディレクトリ内の一時フォルダ（`.design-loop/tmp/`）に保存し、絶対パスをPTYに書き込む。

```javascript
// ツールUIサーバ側のエンドポイント（概念的なコード）
app.post('/api/upload-image', async (req) => {
  const form = await req.formData();
  const image = form.get('image');
  const tmpDir = path.join(sourceDir, '.design-loop', 'tmp');
  await fs.mkdir(tmpDir, { recursive: true });
  const filePath = path.join(tmpDir, image.name);
  await fs.writeFile(filePath, Buffer.from(await image.arrayBuffer()));
  return Response.json({ path: filePath });
});
```

```javascript
// ブラウザ側: ドロップ後にPTYにパスを送信（概念的なコード）
dropArea.addEventListener('drop', async (e) => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  const form = new FormData();
  form.append('image', file);
  const res = await fetch('/api/upload-image', { method: 'POST', body: form });
  const { path } = await res.json();
  ptyWebSocket.send(path);
});
```

UIとしては、ターミナルペインの上部に画像ドロップエリア（またはファイル選択ボタン）を常設する。ドラッグ中はターミナル全体がドロップターゲットとしてハイライトされるようにし、直感的に操作できるようにする。

**プレビューの自動スクリーンショット:** 要素選択時に、選択要素の周辺領域を `html2canvas` またはCanvas APIでキャプチャし、自動的に一時ファイルに保存してコンテキストに含める方法も検討する。デザイナーが明示的に画像をアップロードしなくても、Claude Codeが現在の見た目を把握できるようになる。ただし `html2canvas` はShadow DOMやWebフォントの再現に限界があるため、精度の検証が必要。

## 要素選択モード

プレビュー側に注入するスクリプトは、常時すべてのクリックを横取りすると通常のページ操作（ナビゲーション、フォーム入力、ドロップダウンなど）ができなくなる。そのため、要素選択モードのON/OFFを切り替えられるようにする。

ツールUIの左ペイン上部にトグルボタン（またはキーボードショートカット、例: `Esc` キー）を配置し、選択モードのON/OFFを制御する。選択モードがONのとき、hover時にハイライトが表示され、クリックで要素情報が収集される。OFFのときは通常のブラウジングができる。

選択モードがONの状態では、マウスカーソルを十字カーソルに変更し、視覚的にモードが切り替わっていることをデザイナーに伝える。Chrome DevToolsの要素インスペクタと同じUXを目指す。

## 制約と前提

**Claude Code CLIがインストール済みであること。** このツールはClaude Codeのラッパーではなく、Claude Codeをそのまま使う。ターミナルで `claude` コマンドが実行できる必要がある。

**Dev Serverがlocalhostで動作すること。** プロキシはHTTP通信を前提としており、HTTPS対応は初期スコープ外。

**React 18+のdev modeであること。** React Fiberからコンポーネント情報を取得するため、production buildでは要素選択の精度が落ちる。ただし、computed stylesとCSSセレクタは取得できるので、Claude Codeがファイルを推測して編集することは可能。

**Next.jsのdev serverがiframe表示を許可すること。** 通常デフォルトで許可されているが、CSPが設定されている場合はプロキシでヘッダーを除去する。

## 将来の拡張

**対象フレームワークの拡大:** Vue、Svelte、Astroなど他のフレームワークへの対応。React Fiber依存の部分を抽象化し、フレームワークごとのアダプタを実装する。

**ビジュアルdiff:** 変更前後のスクリーンショットを自動取得し、Before/Afterの比較UIを提供する。PRにも添付する。

**デザイントークン逆引き:** Panda CSSの `panda.config.ts` を解析し、computed stylesの生の値からトークン名への変換テーブルを構築する。選択要素のコンテキスト情報にトークン名を含めることで、Claude Codeの編集精度を向上させる。

**チーム向け機能:** 変更履歴の共有、デザインレビュー機能、Slackへの通知連携。
