# design-loop

Local website design adjustment tool. Interactively modify UI in collaboration with [Claude Code](https://docs.anthropic.com/en/docs/claude-code).

## Install

Download binary from [GitHub Releases](https://github.com/azu/design-loop/releases/latest):

```bash
curl -fsSL "https://github.com/azu/design-loop/releases/latest/download/design-loop-$(uname -s | tr A-Z a-z)-$(uname -m | sed 's/aarch64/arm64/;s/x86_64/x64/')" -o /usr/local/bin/design-loop
chmod +x /usr/local/bin/design-loop
```

## Prerequisites

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI

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
