import { init, Terminal, FitAddon } from "ghostty-web";
import { registerPtyWrite } from "./pty-write.ts";

let terminalInstance: Terminal | null = null;
let wsInstance: WebSocket | null = null;

export async function initTerminal(ptyWsUrl: string): Promise<void> {
  await init();

  const container = document.getElementById("terminal-container");
  if (!container) return;

  const terminal = new Terminal({
    fontSize: 14,
    theme: {
      background: "#0a0a0c",
      foreground: "#ececef",
    },
  });

  terminal.open(container);
  terminalInstance = terminal;

  // Use FitAddon to auto-calculate cols/rows from container size
  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  fitAddon.fit();

  // Connect WebSocket to PTY server
  const ws = new WebSocket(ptyWsUrl);
  ws.binaryType = "arraybuffer";
  wsInstance = ws;

  ws.onopen = () => {
    // Send initial resize with fitted dimensions
    sendResize(terminal, ws);

    // Register shared write function
    registerPtyWrite((text) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(text);
      }
    });
  };

  ws.onmessage = (event: MessageEvent) => {
    const data = event.data;

    // Check for control messages (string starting with \x00)
    if (typeof data === "string" && data.startsWith("\x00")) {
      try {
        const ctrl = JSON.parse(data.slice(1));
        handleControlMessage(ctrl, ws);
      } catch {
        // Not a control message, write to terminal
        terminal.write(data);
      }
      return;
    }

    if (data instanceof ArrayBuffer) {
      // Check if first byte is \x00 (control message)
      const bytes = new Uint8Array(data);
      if (bytes.length > 0 && bytes[0] === 0x00) {
        try {
          const text = new TextDecoder().decode(bytes.slice(1));
          const ctrl = JSON.parse(text);
          handleControlMessage(ctrl, ws);
        } catch {
          terminal.write(bytes);
        }
        return;
      }
      terminal.write(bytes);
    } else {
      terminal.write(data);
    }
  };

  ws.onclose = () => {
    terminal.write("\r\n[Connection closed]\r\n");
  };

  ws.onerror = () => {
    terminal.write("\r\n[Connection error]\r\n");
  };

  // Forward keystrokes to PTY
  terminal.onData((data: string) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });

  // Send resize to PTY when terminal dimensions change (triggered by FitAddon)
  terminal.onResize(({ cols, rows }: { cols: number; rows: number }) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(`\x00${JSON.stringify({ type: "resize", cols, rows })}`);
    }
  });

  // Debounced resize: wait until resizing stops to avoid corrupted rendering
  // Guard against infinite loop: fit() → canvas resize → ResizeObserver → fit()
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  let isFitting = false;
  const resizeObserver = new ResizeObserver(() => {
    if (isFitting) return;
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const dims = fitAddon.proposeDimensions();
      if (!dims || (dims.cols === terminal.cols && dims.rows === terminal.rows)) return;
      isFitting = true;
      fitAddon.fit();
      isFitting = false;
    }, 150);
  });
  resizeObserver.observe(container);

  // Close WebSocket before page unload to prevent stray keystrokes (e.g. "r" from Cmd+R)
  window.addEventListener("beforeunload", () => {
    ws.close();
  });
}

function handleControlMessage(ctrl: { type: string }, ws: WebSocket): void {
  if (ctrl.type === "process-exited") {
    showRestartOverlay(ws);
  } else if (ctrl.type === "process-started") {
    hideRestartOverlay();
  }
}

function showRestartOverlay(ws: WebSocket): void {
  const container = document.getElementById("terminal-container");
  if (!container) return;

  // Don't create duplicate overlay
  if (document.getElementById("restart-overlay")) return;

  const overlay = document.createElement("div");
  overlay.id = "restart-overlay";
  overlay.style.cssText = [
    "position:absolute",
    "inset:0",
    "display:flex",
    "flex-direction:column",
    "align-items:center",
    "justify-content:center",
    "gap:12px",
    "background:rgba(10,10,12,0.92)",
    "z-index:50",
  ].join(";");

  const msg = document.createElement("div");
  msg.textContent = "Process exited";
  msg.style.cssText = "color:#6e6e7a;font-size:14px;";

  const btn = document.createElement("button");
  btn.textContent = "Restart Claude";
  btn.style.cssText = [
    "padding:8px 20px",
    "border:1px solid #e8913a",
    "border-radius:6px",
    "background:#e8913a",
    "color:#0a0a0c",
    "cursor:pointer",
    "font-size:14px",
    "font-weight:600",
  ].join(";");

  btn.addEventListener("click", () => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(`\x00${JSON.stringify({ type: "restart" })}`);
    }
  });

  overlay.appendChild(msg);
  overlay.appendChild(btn);
  container.appendChild(overlay);
}

function hideRestartOverlay(): void {
  const overlay = document.getElementById("restart-overlay");
  if (overlay) {
    overlay.remove();
  }
}

function sendResize(terminal: Terminal, ws: WebSocket): void {
  const cols = terminal.cols ?? 120;
  const rows = terminal.rows ?? 40;
  ws.send(`\x00${JSON.stringify({ type: "resize", cols, rows })}`);
}

export function writeToTerminal(text: string): void {
  if (wsInstance && wsInstance.readyState === WebSocket.OPEN) {
    wsInstance.send(text);
  }
}
