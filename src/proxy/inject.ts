import injectScriptSource from "../ui/inject-script.ts" with { type: "file" };

export async function getInjectScript(): Promise<string> {
  const result = await Bun.build({
    entrypoints: [injectScriptSource],
    target: "browser",
    format: "iife",
    minify: true,
  });

  if (!result.success) {
    throw new Error(`Failed to build inject script: ${result.logs.join("\n")}`);
  }

  return result.outputs[0].text();
}
