import type { ChildProcess } from "node:child_process";
import type { Server } from "bun";
import { resolve as resolvePath } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import open from "open";

import type { DesignLoopConfig } from "./config.ts";
import { logger } from "./logger.ts";
import { tryPort } from "./port.ts";
import { startProxyServer } from "./proxy/proxy-server.ts";
import { startPtyServer, type PtyServerResult } from "./pty/pty-server.ts";
import { startUiServer } from "./ui-server.ts";
import { startDevServer } from "./dev-server.ts";
const execFileAsync = promisify(execFile);

export type StartOptions = {
  noOpen?: boolean;
  port?: number;
};

export async function startDesignLoop(config?: DesignLoopConfig, options?: StartOptions): Promise<void> {
  if (!config) {
    console.log("design-loop: no config provided");
    return;
  }

  const sourceDir = resolvePath(config.source);

  // Check if claude command is available
  try {
    await execFileAsync("which", ["claude"]);
  } catch {
    console.error(
      "[design-loop] 'claude' command not found. Install Claude Code CLI first.",
    );
    process.exit(1);
  }

  // Find ports (use defaults, fall back to random if occupied)
  const basePort = options?.port ?? 5757;
  const [uiPort, proxyPort, ptyPort] = await Promise.all([
    tryPort(basePort),
    tryPort(basePort + 1),
    tryPort(basePort + 2),
  ]);

  const proxyUrl = `http://127.0.0.1:${proxyPort}`;
  const ptyWsUrl = `ws://127.0.0.1:${ptyPort}`;
  const uiUrl = `http://127.0.0.1:${uiPort}`;
  const allowedOrigin = uiUrl;

  // Track resources for cleanup
  let devServerProcess: ChildProcess | undefined;
  let proxyServer: ReturnType<typeof import("node:http").createServer> | undefined;
  let ptyResult: PtyServerResult | undefined;
  let uiServer: Server<unknown> | undefined;

  const cleanup = () => {
    console.log("\n[design-loop] Shutting down...");
    ptyResult?.close();
    proxyServer?.close();
    uiServer?.stop();
    if (devServerProcess && !devServerProcess.killed) {
      devServerProcess.kill("SIGTERM");
    }
  };

  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });

  // Start dev server if command provided
  if (config.devServer.command) {
    logger.info(`[design-loop] Starting dev server: ${config.devServer.command}`);
    try {
      devServerProcess = await startDevServer({
        command: config.devServer.command,
        cwd: sourceDir,
        waitOnUrl: config.devServer.url,
      });
      console.log("[design-loop] Dev server ready");
    } catch (err) {
      console.error("[design-loop] Failed to start dev server:", err);
      process.exit(1);
    }
  }

  // Start proxy server
  logger.info(`[design-loop] Starting proxy → ${config.devServer.url}`);
  proxyServer = await startProxyServer({
    upstream: config.devServer.url,
    port: proxyPort,
    allowedOrigin,
  });
  logger.info(`[design-loop] Proxy: ${proxyUrl}`);

  // Build system prompt for Claude
  const systemPromptParts: string[] = [];
  systemPromptParts.push(
    `This is a design-loop session. A designer is viewing the app in a browser and sending you instructions to adjust the UI.`,
  );
  systemPromptParts.push(
    `Response rules:
- Reply in the same language the designer uses
- Respond concisely. Describe changes in visual terms, not code internals
- Only change what the designer asked for. Do not refactor or modify unrelated code
- When making style changes, prefer existing design tokens (Tailwind, Panda CSS, CSS variables, etc.) over hardcoded values`,
  );
  systemPromptParts.push(
    `Scope restrictions:
- Only modify files related to the designer's UI request
- Do NOT run git commands, rename/move/delete files, or modify config files`,
  );
  systemPromptParts.push(
    `Design Mode changes:
When you receive "[Design Mode Changes]", the designer has visually edited the page. Follow these steps:
1. Read the source file first. Understand the component structure before making changes
2. For text edits: find the exact text in the source and replace it
3. For element reorder: the change shows the element's original position and desired position
   - In React/JSX: move the JSX element within the SAME component. Do NOT move elements across component boundaries
   - Check that the moved element stays within its parent component's render
   - If the move would cross component boundaries, explain this to the designer and suggest alternatives (e.g., reordering props, changing the parent component's children order)
4. After applying changes, verify the code compiles correctly
5. The CSS selector is a hint for locating the element. Always use the React component name and source file path when available`,
  );
  systemPromptParts.push(`Source directory: ${sourceDir}`);
  if (config.appDir) {
    systemPromptParts.push(`App directory: ${config.appDir} (relative to source)`);
  }
  systemPromptParts.push(`Dev server URL: ${config.devServer.url}`);
  if (config.context?.files && config.context.files.length > 0) {
    const fileList = config.context.files.map((f) => `- ${f}`).join("\n");
    systemPromptParts.push(
      `\nDesign token files (read before making style changes):\n${fileList}`,
    );
  }
  if (config.context?.instructions) {
    systemPromptParts.push(`\nProject instructions:\n${config.context.instructions}`);
  }
  const systemPrompt = systemPromptParts.join("\n");

  // Start PTY server
  ptyResult = startPtyServer({
    port: ptyPort,
    cwd: sourceDir,
    allowedOrigin,
    systemPrompt,
  });
  logger.info(`[design-loop] PTY WebSocket: ${ptyWsUrl}`);

  // Start UI server
  uiServer = await startUiServer({
    port: uiPort,
    proxyUrl,
    ptyWsUrl,
    sourceDir,
    appDir: config.appDir,
    allowedOrigin,
  });
  logger.info(`[design-loop] UI: ${uiUrl}`);

  // Open browser
  if (!options?.noOpen) {
    logger.info(`[design-loop] Opening browser...`);
    await open(uiUrl);
  }

  console.log("\n[design-loop] Ready. Press Ctrl+C to stop.\n");
}
