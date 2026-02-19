import type http from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WebSocketServer, type WebSocket } from "ws";
import { logger } from "../logger.ts";

export type PtyServerOptions = {
  port: number;
  cwd: string;
  command?: string;
  allowedOrigin?: string;
  systemPrompt?: string;
};

export type PtyServerResult = {
  wss: WebSocketServer;
  close: () => void;
};

// Ring buffer to store recent terminal output for replay on reconnect
const MAX_BUFFER_SIZE = 128 * 1024; // 128KB

export function startPtyServer(options: PtyServerOptions): PtyServerResult {
  const {
    port,
    cwd,
    command = "claude",
    allowedOrigin,
    systemPrompt,
  } = options;

  const shell = process.env.SHELL ?? "/bin/zsh";

  // Build command with --append-system-prompt if provided
  const tmpDir = join(tmpdir(), "design-loop");
  const tmpPath = join(tmpDir, "system-prompt.txt");
  let fullCommand = command;
  if (systemPrompt && command === "claude") {
    fullCommand = `${command} --append-system-prompt "$(cat '${tmpPath}')"`;
  }

  logger.info(`[design-loop pty] Command: ${shell} -l -c ${fullCommand}`);
  logger.info(`[design-loop pty] CWD: ${cwd}`);

  const connections = new Set<WebSocket>();
  let terminal: InstanceType<typeof Bun.Terminal> | null = null;
  let proc: ReturnType<typeof Bun.spawn> | null = null;
  let processRunning = false;
  let lastCols = 80;
  let lastRows = 24;

  // Buffer for replaying to new connections
  const outputChunks: Uint8Array[] = [];
  let outputSize = 0;

  function appendToBuffer(data: Uint8Array) {
    outputChunks.push(new Uint8Array(data));
    outputSize += data.length;

    while (outputSize > MAX_BUFFER_SIZE && outputChunks.length > 1) {
      const removed = outputChunks.shift();
      if (removed) {
        outputSize -= removed.length;
      }
    }
  }

  function clearBuffer() {
    outputChunks.length = 0;
    outputSize = 0;
  }

  function getBufferedOutput(): Uint8Array {
    if (outputChunks.length === 0) return new Uint8Array(0);
    const result = new Uint8Array(outputSize);
    let offset = 0;
    for (const chunk of outputChunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }

  function broadcastControl(msg: Record<string, unknown>) {
    const data = `\x00${JSON.stringify(msg)}`;
    for (const ws of connections) {
      if (ws.readyState === ws.OPEN) {
        ws.send(data);
      }
    }
  }

  function spawnProcess(cols: number, rows: number) {
    // Clean up previous terminal if restarting
    if (terminal) {
      terminal.close();
      terminal = null;
    }

    lastCols = cols;
    lastRows = rows;
    clearBuffer();

    // Write system prompt file before each spawn (may have been cleaned up)
    if (systemPrompt && command === "claude") {
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(tmpPath, systemPrompt, "utf-8");
    }

    logger.info(`[design-loop pty] Spawning with ${cols}x${rows}`);

    terminal = new Bun.Terminal({
      cols,
      rows,
      name: "xterm-256color",
      data(_term, data) {
        appendToBuffer(data);
        for (const ws of connections) {
          if (ws.readyState === ws.OPEN) {
            ws.send(data);
          }
        }
      },
    });

    proc = Bun.spawn([shell, "-l", "-c", fullCommand], {
      terminal,
      cwd,
    });

    processRunning = true;
    broadcastControl({ type: "process-started" });

    // Watch for process exit
    proc.exited.then(() => {
      logger.info("[design-loop pty] Process exited");
      processRunning = false;
      broadcastControl({ type: "process-exited" });
    });
  }

  const wss = new WebSocketServer({
    port,
    host: "127.0.0.1",
    verifyClient: allowedOrigin
      ? (info: { origin: string; secure: boolean; req: http.IncomingMessage }) => {
          return info.origin === allowedOrigin;
        }
      : undefined,
  });

  wss.on("connection", (ws) => {
    connections.add(ws);

    let hasResized = false;

    // If process already exited, notify new connection
    if (terminal && !processRunning) {
      ws.send(`\x00${JSON.stringify({ type: "process-exited" })}`);
    }

    ws.on("message", (msg) => {
      const str = msg.toString();
      // Control messages are prefixed with null byte
      if (str.startsWith("\x00")) {
        try {
          const ctrl = JSON.parse(str.slice(1));
          if (ctrl.type === "resize") {
            const cols = Number(ctrl.cols) || 80;
            const rows = Number(ctrl.rows) || 24;
            lastCols = cols;
            lastRows = rows;

            if (!terminal) {
              spawnProcess(cols, rows);
            } else {
              terminal.resize(cols, rows);

              // Replay buffer on first resize of a reconnection
              if (!hasResized) {
                const buf = getBufferedOutput();
                if (buf.length > 0) {
                  ws.send(buf);
                }
              }
            }
            hasResized = true;
          } else if (ctrl.type === "restart") {
            // Restart the process
            spawnProcess(lastCols, lastRows);
          }
        } catch {
          // Ignore malformed control messages
        }
      } else if (terminal) {
        terminal.write(str);
      }
    });

    ws.on("close", () => {
      connections.delete(ws);
    });
  });

  const close = () => {
    for (const ws of connections) {
      ws.close();
    }
    connections.clear();
    if (terminal) {
      terminal.close();
    }
    if (proc) {
      proc.kill();
    }
    wss.close();
  };

  return { wss, close };
}
