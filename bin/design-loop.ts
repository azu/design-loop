#!/usr/bin/env node
import { parseArgs } from "node:util";
import { parseCliArgs, resolveConfig } from "../src/config.ts";
import { startDesignLoop } from "../src/cli.ts";
import { setLogLevel, type LogLevel } from "../src/logger.ts";
import { runUpdateSafe } from "../src/update.ts";

const subcommand = process.argv[2];

if (subcommand === "update") {
  await runUpdateSafe();
  process.exit(0);
}

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    help: { type: "boolean", short: "h" },
    version: { type: "boolean", short: "v" },
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
  console.log(`Usage: design-loop [command] [options]

Commands:
  update             Update design-loop to the latest version

Options:
  --url=<url>        Dev server URL (e.g. http://localhost:3000)
  --command=<cmd>    Command to start dev server (e.g. "pnpm run dev")
  --source=<path>    Path to source directory (default: ".")
  --app-dir=<path>   App directory relative to source (for monorepo)
  --port, -p <port>  UI server port (default: 5757)
  --no-open          Skip opening browser automatically
  --log-level <lvl>  Log level: debug, info, warn, error (default: info)
  --version, -v      Show version
  --help, -h         Show this help message`);
  process.exit(0);
}

if (values.version) {
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const pkg = require("../package.json") as { version: string };
  console.log(`design-loop v${pkg.version}`);
  process.exit(0);
}

if (values["log-level"]) {
  setLogLevel(values["log-level"] as LogLevel);
}

const args = parseCliArgs(process.argv.slice(2));
const config = await resolveConfig(args);
const port = values.port ? parseInt(String(values.port), 10) : undefined;
await startDesignLoop(config, { noOpen: !!values["no-open"], port });
