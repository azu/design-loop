import type { ChildProcess } from "node:child_process";
import type http from "node:http";
import { resolve as resolvePath } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import open from "open";

import type { DesignLoopConfig } from "./config.ts";
import { findFreePort } from "./port.ts";
import { startProxyServer } from "./proxy/proxy-server.ts";
import { startPtyServer, type PtyServerResult } from "./pty/pty-server.ts";
import { startUiServer } from "./ui-server.ts";
import { startDevServer } from "./dev-server.ts";
import { createWorkBranch, getCurrentBranch } from "./git.ts";

const execFileAsync = promisify(execFile);

export async function startDesignLoop(config?: DesignLoopConfig): Promise<void> {
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
  try {
    baseBranch = await getCurrentBranch(sourceDir);
    const workBranch = await createWorkBranch(sourceDir);
    console.log(`[design-loop] Created work branch: ${workBranch} (base: ${baseBranch})`);
  } catch {
    console.log("[design-loop] Git branch creation skipped (not a git repo or no commits)");
  }

  // Find free ports
  const [proxyPort, ptyPort, uiPort] = await Promise.all([
    findFreePort(),
    findFreePort(),
    findFreePort(),
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
    console.log(`[design-loop] Starting dev server: ${config.devServer.command}`);
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
  console.log(`[design-loop] Starting proxy → ${config.devServer.url}`);
  proxyServer = await startProxyServer({
    upstream: config.devServer.url,
    port: proxyPort,
    allowedOrigin,
  });
  console.log(`[design-loop] Proxy: ${proxyUrl}`);

  // Build initial prompt from config
  let initialPrompt: string | undefined;
  if (config.context?.instructions) {
    initialPrompt = config.context.instructions + "\n";
  }

  // Start PTY server
  ptyResult = startPtyServer({
    port: ptyPort,
    cwd: sourceDir,
    allowedOrigin,
    initialPrompt,
  });
  console.log(`[design-loop] PTY WebSocket: ${ptyWsUrl}`);

  // Start UI server
  uiServer = await startUiServer({
    port: uiPort,
    proxyUrl,
    ptyWsUrl,
    sourceDir,
    allowedOrigin,
  });
  console.log(`[design-loop] UI: ${uiUrl}`);

  // Open browser
  console.log(`[design-loop] Opening browser...`);
  await open(uiUrl);

  console.log("\n[design-loop] Ready. Press Ctrl+C to stop.\n");
}
