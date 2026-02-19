import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";

export type DevServerConfig = {
  command?: string;
  url: string;
  readyPattern?: string;
};

export type ElementSelectionConfig = {
  framework: string;
  ignoreSelectors: string[];
};

export type ContextConfig = {
  files: string[];
  instructions: string;
};

export type DesignLoopConfig = {
  devServer: DevServerConfig;
  context?: ContextConfig;
  elementSelection?: ElementSelectionConfig;
  source?: string;
  appDir?: string;
};

type ConfigFile = {
  devServer?: Partial<DevServerConfig>;
  context?: ContextConfig;
  elementSelection?: Partial<ElementSelectionConfig>;
};

export async function loadConfigFile(
  sourcePath: string,
): Promise<ConfigFile | null> {
  const configPath = join(sourcePath, ".design-loop.json");
  try {
    const content = await readFile(configPath, "utf-8");
    return JSON.parse(content) as ConfigFile;
  } catch {
    return null;
  }
}

export type CliArgs = {
  url?: string;
  command?: string;
  source?: string;
  appDir?: string;
};

export function parseCliArgs(argv: string[]): CliArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      url: { type: "string" },
      command: { type: "string" },
      source: { type: "string" },
      "app-dir": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    strict: false,
    allowPositionals: true,
  });

  return {
    url: values.url as string | undefined,
    command: values.command as string | undefined,
    source: values.source as string | undefined,
    appDir: values["app-dir"] as string | undefined,
  };
}

export async function resolveConfig(cliArgs: CliArgs): Promise<DesignLoopConfig> {
  const source = cliArgs.source;
  const configFile = source ? await loadConfigFile(source) : null;

  const url = cliArgs.url ?? configFile?.devServer?.url;
  if (!url) {
    throw new Error(
      "URL is required. Use --url or set devServer.url in .design-loop.json",
    );
  }

  return {
    devServer: {
      url,
      command: cliArgs.command ?? configFile?.devServer?.command,
      readyPattern: configFile?.devServer?.readyPattern,
    },
    context: configFile?.context,
    elementSelection: configFile?.elementSelection
      ? {
          framework: configFile.elementSelection.framework ?? "react",
          ignoreSelectors: configFile.elementSelection.ignoreSelectors ?? [],
        }
      : undefined,
    source,
    appDir: cliArgs.appDir,
  };
}
