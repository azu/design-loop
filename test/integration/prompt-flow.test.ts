import { describe, expect, test, afterEach } from "bun:test";
import { startPtyServer, type PtyServerResult } from "../../src/pty/pty-server.ts";
import { findFreePort } from "../../src/port.ts";
import WebSocket from "ws";

const ptys: PtyServerResult[] = [];

afterEach(() => {
  for (const p of ptys) p.close();
  ptys.length = 0;
});

function connectAndInit(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on("open", () => {
      // Send resize to initialize the terminal
      ws.send('\x00{"type":"resize","cols":80,"rows":24}');
      setTimeout(() => resolve(ws), 200);
    });
    ws.on("error", reject);
  });
}

function collectOutput(ws: WebSocket, match: string, timeoutMs = 3000): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const handler = (data: WebSocket.Data) => {
      buffer += data.toString();
      if (buffer.includes(match)) {
        ws.off("message", handler);
        resolve(buffer);
      }
    };
    ws.on("message", handler);
    setTimeout(() => {
      ws.off("message", handler);
      reject(new Error(`Timeout waiting for "${match}" in output. Got: ${buffer.slice(-200)}`));
    }, timeoutMs);
  });
}

// PTY tests require posix_spawnp (not available in all sandboxes)
const canSpawn = (() => {
  try {
    Bun.spawnSync({ cmd: ["/bin/echo", "test"] });
    return true;
  } catch {
    return false;
  }
})();

const describeOrSkip = canSpawn ? describe : describe.skip;

describeOrSkip("prompt flow: element info → PTY", () => {
  test("text written to WebSocket arrives in PTY process", async () => {
    const port = await findFreePort();
    const result = startPtyServer({
      port,
      cwd: process.cwd(),
      command: "/bin/sh",
    });
    ptys.push(result);

    await new Promise((r) => setTimeout(r, 200));
    const ws = await connectAndInit(port);

    // Send a command like element-selection.ts would
    ws.send("echo prompt-flow-test\r");

    const output = await collectOutput(ws, "prompt-flow-test");
    expect(output).toContain("prompt-flow-test");

    ws.close();
  }, 10000);

  test("bracketed paste is forwarded to PTY", async () => {
    const port = await findFreePort();
    const result = startPtyServer({
      port,
      cwd: process.cwd(),
      command: "/bin/sh",
    });
    ptys.push(result);

    await new Promise((r) => setTimeout(r, 200));
    const ws = await connectAndInit(port);

    // Send bracketed paste (context) then command then enter
    // This simulates what element-selection.ts sendPrompt does
    const context = "[URL: /login]\n[<button> .login-btn]";
    ws.send(`\x1b[200~${context}\x1b[201~`);

    // Wait a bit, then send the actual command
    await new Promise((r) => setTimeout(r, 200));
    ws.send(" echo bracket-test\r");

    const output = await collectOutput(ws, "bracket-test");
    expect(output).toContain("bracket-test");

    ws.close();
  }, 10000);

  test("full prompt sequence: context + space + text + enter", async () => {
    const port = await findFreePort();
    const result = startPtyServer({
      port,
      cwd: process.cwd(),
      command: "/bin/cat",
    });
    ptys.push(result);

    await new Promise((r) => setTimeout(r, 200));
    const ws = await connectAndInit(port);

    // Simulate the full sendPrompt flow from element-selection.ts:
    // Use /bin/cat so all input is echoed back (sh can't handle bracketed paste)
    // 1. Bracketed paste with context
    ws.send(`\x1b[200~[URL: /page]\x1b[201~`);
    await new Promise((r) => setTimeout(r, 100));

    // 2. Space separator
    ws.send(" ");

    // 3. User text
    ws.send("make button red");

    // 4. Enter
    await new Promise((r) => setTimeout(r, 100));
    ws.send("\r");

    // cat echoes all input, so we can verify the data arrived at the PTY
    const output = await collectOutput(ws, "make button red");
    expect(output).toContain("make button red");

    ws.close();
  }, 10000);
});
