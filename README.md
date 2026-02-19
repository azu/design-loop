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

```bash
design-loop --url http://localhost:3000
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

## License

MIT
