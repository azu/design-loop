import { $ } from "bun";
import { mkdir } from "node:fs/promises";

const targets = [
  { name: "darwin-arm64", target: "bun-darwin-arm64" },
  { name: "darwin-x64", target: "bun-darwin-x64" },
  { name: "linux-x64", target: "bun-linux-x64" },
  { name: "linux-arm64", target: "bun-linux-arm64" },
] as const;

const selectedTarget = process.argv[2];

await mkdir("dist/bin", { recursive: true });

for (const { name, target } of targets) {
  if (selectedTarget && name !== selectedTarget) continue;

  const outfile = `dist/bin/design-loop-${name}`;
  console.log(`Building ${outfile} (${target})...`);

  await $`bun build --compile --minify --target=${target} ./bin/design-loop.ts --outfile ${outfile}`;

  console.log(`  Done: ${outfile}`);
}
