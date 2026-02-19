# design-loop

A browser-based frontend for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) that lets designers edit websites without touching code.

Preview your site and Claude Code side by side in a single browser window — no terminal or editor needed. Select elements, describe changes in natural language, and Claude Code modifies the source code directly. Since it runs Claude Code under the hood, anything Claude Code can do is supported.

<video src="https://github.com/user-attachments/assets/02cf182e-9d43-488f-ac57-787dbb228d9e" controls></video>

## Features

- **Visual Element Selection** — Click any element on the page to select it and pass it as context to Claude Code.
- **React Integration** — Automatically detects React component names, props, and source file paths. Works with Next.js and other React frameworks.
- **Live Preview** — See changes in real-time with hot reload support (HMR, SSE).
- **Single Window Workflow** — Preview and Claude Code terminal side by side in one browser tab. Replaces the three-app workflow (terminal + editor + browser).
- **File Upload** — Drag-and-drop or paste images and files to include in design instructions.
- **Design Mode** — Edit text and reorder elements directly in the browser. Changes are sent to Claude Code to update the source code.
- **Dev Server Proxy** — Transparent proxy that preserves HMR/WebSocket connections and injects the selection overlay.
- **Config File** (Experimental) — `.design-loop.json` for project-specific settings: dev server command, design tokens, and framework options.

## Design Mode

<video src="https://github.com/user-attachments/assets/43eab003-d422-4fc1-9695-1def1376f818" controls></video>

Design Mode lets you visually edit the page and have Claude Code apply the changes to the source code.

Click the "Design Mode" button in the toolbar to activate it. The button turns green when active. Design Mode and Select Element mode are mutually exclusive.

### Text editing

Click any text element (headings, paragraphs, buttons, links, etc.) to edit its content directly. Press Enter to confirm or Escape to cancel. IME input (Japanese, Chinese, Korean) is supported.

### Drag and drop

Drag elements to reorder them within their parent container. The drop indicator adapts to the layout direction — horizontal line for vertical layouts, vertical line for horizontal layouts (flex-row, grid).

For text-editable elements like buttons, hold the mouse for 200ms to enable dragging. A short click opens text editing instead.

### Applying changes

Changes accumulate in a log. Click "Apply Changes" to send all changes to Claude Code at once. The changes are normalized before sending — duplicate moves on the same element are collapsed, and moves that return to the original position are removed.

### Undo

Press Cmd+Z (Mac) or Ctrl+Z (Windows/Linux) to undo the last change. This works both in the preview and the parent frame. The "Clear" button undoes all changes.

## Prerequisites

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI

## Install

Download binary from [GitHub Releases](https://github.com/azu/design-loop/releases/latest):

```bash
curl -fsSL https://raw.githubusercontent.com/azu/design-loop/main/install.sh | sh
```

Or manually:

```bash
mkdir -p ~/.local/bin
curl -fsSL "https://github.com/azu/design-loop/releases/latest/download/design-loop-$(uname -s | tr A-Z a-z)-$(uname -m | sed 's/aarch64/arm64/;s/x86_64/x64/')" -o ~/.local/bin/design-loop
chmod +x ~/.local/bin/design-loop
```

## Update

Update to the latest version with:

```bash
design-loop update
```


## Usage

Specify the URL of a running dev server to start design-loop.

### Connect to a running dev server

```bash
design-loop --url http://localhost:3000
```

### Auto-start a dev server

Use `--command` to let design-loop start the dev server automatically.

```bash
design-loop --url http://localhost:3000 --command "npm run dev"
```

### Monorepo

Use `--source` for the project root and `--app-dir` for the app directory.

```bash
design-loop --url http://localhost:3000 --source /path/to/monorepo --app-dir packages/web
```

### Config file

Place `.design-loop.json` in the project root to omit CLI options.

```json
{
  "devServer": {
    "url": "http://localhost:3000",
    "command": "npm run dev"
  }
}
```

```bash
design-loop
```

Additional config options (experimental — may break in future releases):

```json
{
  "devServer": {
    "url": "http://localhost:3000",
    "command": "npm run dev"
  },
  "context": {
    "files": ["src/theme.css", "src/tokens.ts"],
    "instructions": "Use existing design tokens and Tailwind utilities only"
  },
  "elementSelection": {
    "framework": "react",
    "ignoreSelectors": [".tooltip", ".overlay"]
  }
}
```

- `context.files` - Design token files to include as context for Claude
- `context.instructions` - Project-specific instructions for Claude
- `elementSelection.framework` - UI framework name (default: `"react"`)
- `elementSelection.ignoreSelectors` - CSS selectors to exclude from element selection

## Options

```
--url=<url>        Dev server URL (e.g. http://localhost:3000)
--command=<cmd>    Command to start dev server (e.g. "pnpm run dev")
--source=<path>    Path to source directory (default: ".")
--app-dir=<path>   App directory relative to source (for monorepo)
--port, -p <port>  UI server port (default: 5757)
--no-open          Skip opening browser automatically
--log-level <lvl>  Log level: debug, info, warn, error (default: info)
```

## Development

```bash
bun install
bun run dev
```

`bun run dev` starts both fixtures/test-app (port 3456) and the design-loop UI.

## License

MIT
