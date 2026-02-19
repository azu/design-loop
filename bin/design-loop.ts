#!/usr/bin/env node
import { parseArgs } from "node:util";
import { parseCliArgs, resolveConfig } from "../src/config.ts";
import { startDesignLoop } from "../src/cli.ts";
import { setLogLevel, type LogLevel } from "../src/logger.ts";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    help: { type: "boolean", short: "h" },
    url: { type: "string" },
    command: { type: "string" },
    source: { type: "string" },
    "app-dir": { type: "string" },
    port: { type: "string", short: "p" },
    "no-open": { type: "boolean" },
    "log-level": { type: "string" },
  },
  strict: false,
  allowPositionals: true,
});

if (values.help) {
  console.log(`Usage: design-loop [options]

Options:
  --url=<url>        Target URL (local dev server or deployed site)
  --command=<cmd>    Command to start dev server (e.g. "pnpm run dev")
  --source=<path>    Path to source directory (omit for external URL mode)
  --app-dir=<path>   App directory relative to source (for monorepo)
  --port, -p <port>  UI server port (default: 5757)
  --no-open          Skip opening browser automatically
  --log-level <lvl>  Log level: debug, info, warn, error (default: info)
  --help, -h         Show this help message

Examples:
  design-loop --url=http://localhost:3000 --source=.
  design-loop --url=https://example.com`);
  process.exit(0);
}

if (values["log-level"]) {
  setLogLevel(values["log-level"] as LogLevel);
}

const args = parseCliArgs(process.argv.slice(2));
const config = await resolveConfig(args);
const port = values.port ? parseInt(String(values.port), 10) : undefined;
await startDesignLoop(config, { noOpen: !!values["no-open"], port });
