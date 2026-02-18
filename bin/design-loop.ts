#!/usr/bin/env node
import { parseArgs } from "node:util";
import { parseCliArgs, resolveConfig } from "../src/config.ts";
import { startDesignLoop } from "../src/cli.ts";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    help: { type: "boolean", short: "h" },
    url: { type: "string" },
    command: { type: "string" },
    source: { type: "string" },
  },
  strict: false,
  allowPositionals: true,
});

if (values.help) {
  console.log(`Usage: design-loop run [options]

Options:
  --url=<url>        Dev server URL (e.g. http://localhost:3000)
  --command=<cmd>    Command to start dev server (e.g. "pnpm run dev")
  --source=<path>    Path to source directory (default: ".")
  --help, -h         Show this help message`);
  process.exit(0);
}

const args = parseCliArgs(process.argv.slice(2));
const config = await resolveConfig(args);
await startDesignLoop(config);
