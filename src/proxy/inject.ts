// @ts-expect-error Bun-specific import attribute for file path
import injectScriptSource from "../ui/inject-script.ts" with { type: "file" };

export async function getInjectScript(): Promise<string> {
  const source = await Bun.file(injectScriptSource).text();
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  return transpiler.transformSync(source);
}
