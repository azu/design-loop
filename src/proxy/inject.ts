import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

let cachedScript: string | null = null;

export async function getInjectScript(): Promise<string> {
  if (cachedScript) return cachedScript;

  // In dev: read from dist/ui/inject-script.js
  // The path is resolved relative to this file's location
  const thisDir = dirname(fileURLToPath(import.meta.url));
  const scriptPath = join(thisDir, "..", "..", "dist", "ui", "inject-script.js");

  try {
    cachedScript = await readFile(scriptPath, "utf-8");
  } catch {
    // Fallback: try relative to process.cwd()
    cachedScript = await readFile(
      join(process.cwd(), "dist", "ui", "inject-script.js"),
      "utf-8",
    );
  }
  return cachedScript;
}
