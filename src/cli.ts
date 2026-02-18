import type { ChildProcess } from "node:child_process";
import type http from "node:http";
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
import { createWorkBranch, getCurrentBranch } from "./git.ts";

const execFileAsync = promisify(execFile);

export type StartOptions = {
  noBranch?: boolean;
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

  // Git: record current branch and create work branch
  let baseBranch: string | undefined;
  if (!options?.noBranch) {
    try {
      baseBranch = await getCurrentBranch(sourceDir);
      const workBranch = await createWorkBranch(sourceDir);
      logger.info(`[design-loop] Created work branch: ${workBranch} (base: ${baseBranch})`);
    } catch {
      console.log("[design-loop] Git branch creation skipped (not a git repo or no commits)");
    }
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
  let proxyServer: http.Server | undefined;
  let ptyResult: PtyServerResult | undefined;
  let uiServer: http.Server | undefined;

  const cleanup = () => {
    console.log("\n[design-loop] Shutting down...");
    ptyResult?.close();
    proxyServer?.close();
    uiServer?.close();
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
        readyPattern: config.devServer.readyPattern,
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
  systemPromptParts.push(`This is a design-loop session. A designer is viewing the app in a browser and sending you instructions to adjust the UI.`);
  systemPromptParts.push(`Source directory: ${sourceDir}`);
  if (config.appDir) {
    systemPromptParts.push(`App directory: ${config.appDir} (relative to source)`);
  }
  systemPromptParts.push(`Dev server URL: ${config.devServer.url}`);
  if (config.context?.instructions) {
    systemPromptParts.push(`\nDesigner instructions:\n${config.context.instructions}`);
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
  if (!options.noOpen) {
    logger.info(`[design-loop] Opening browser...`);
    await open(uiUrl);
  }

  console.log("\n[design-loop] Ready. Press Ctrl+C to stop.\n");
}
