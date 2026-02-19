import { describe, expect, test, afterEach } from "bun:test";
import { startPtyServer, type PtyServerResult } from "../../src/pty/pty-server.ts";
import { findFreePort } from "../../src/port.ts";
import WebSocket from "ws";

const ptys: PtyServerResult[] = [];

afterEach(() => {
  for (const p of ptys) {
    p.close();
  }
  ptys.length = 0;
});

function connectWebSocket(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on("open", () => {
      // Send resize to initialize the terminal (PTY requires resize before spawning)
      ws.send('\x00{"type":"resize","cols":80,"rows":24}');
      setTimeout(() => resolve(ws), 200);
    });
    ws.on("error", reject);
  });
}

function waitForMessage(ws: WebSocket): Promise<string> {
  return new Promise((resolve) => {
    ws.once("message", (data) => {
      resolve(data.toString());
    });
  });
}

// node-pty requires posix_spawnp which may not be available in sandboxed environments.
// Run these tests manually with: bun test test/integration/pty.test.ts
const canSpawn = (() => {
  try {
    const pty = require("node-pty");
    const p = pty.spawn("/bin/echo", ["test"], { cwd: process.cwd() });
    p.kill();
    return true;
  } catch {
    return false;
  }
})();

const describeOrSkip = canSpawn ? describe : describe.skip;

describeOrSkip("pty-server", () => {
  test("spawns a command and streams output over WebSocket", async () => {
    const port = await findFreePort();
    const result = startPtyServer({
      port,
      cwd: process.cwd(),
      command: "/bin/sh",
    });
    ptys.push(result);

    // Give the PTY server a moment to start
    await new Promise((r) => setTimeout(r, 200));

    const ws = await connectWebSocket(port);

    // Send a command and wait for its output
    ws.send("echo pty-spawn-test\n");

    const output = await new Promise<string>((resolve, reject) => {
      let buffer = "";
      const handler = (data: WebSocket.Data) => {
        buffer += data.toString();
        if (buffer.includes("pty-spawn-test")) {
          ws.off("message", handler);
          resolve(buffer);
        }
      };
      ws.on("message", handler);
      setTimeout(() => {
        ws.off("message", handler);
        reject(new Error(`Timeout. Got: ${buffer.slice(-200)}`));
      }, 5000);
    });

    expect(output).toContain("pty-spawn-test");

    ws.close();
  }, 10000);

  test("handles resize control messages", async () => {
    const port = await findFreePort();
    const result = startPtyServer({
      port,
      cwd: process.cwd(),
      command: "/bin/sh",
    });
    ptys.push(result);

    await new Promise((r) => setTimeout(r, 200));

    const ws = await connectWebSocket(port);

    // Send resize control message (should not throw)
    ws.send('\x00{"type":"resize","cols":80,"rows":24}');

    // Send a command to verify PTY still works
    ws.send("echo test-resize\n");

    // Wait for output containing our test string
    const output = await new Promise<string>((resolve) => {
      let buffer = "";
      ws.on("message", (data) => {
        buffer += data.toString();
        if (buffer.includes("test-resize")) {
          resolve(buffer);
        }
      });
    });

    expect(output).toContain("test-resize");

    ws.close();
  });

  test("forwards input to PTY", async () => {
    const port = await findFreePort();
    const result = startPtyServer({
      port,
      cwd: process.cwd(),
      command: "/bin/sh",
    });
    ptys.push(result);

    await new Promise((r) => setTimeout(r, 200));

    const ws = await connectWebSocket(port);

    ws.send("echo hello-pty-test\n");

    const output = await new Promise<string>((resolve) => {
      let buffer = "";
      ws.on("message", (data) => {
        buffer += data.toString();
        if (buffer.includes("hello-pty-test")) {
          resolve(buffer);
        }
      });
    });

    expect(output).toContain("hello-pty-test");

    ws.close();
  });
});
