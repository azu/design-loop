import { describe, expect, test, afterEach } from "bun:test";
import type { ChildProcess } from "node:child_process";
import { startDevServer } from "../../src/dev-server.ts";

const processes: ChildProcess[] = [];

afterEach(() => {
  for (const p of processes) {
    if (!p.killed) p.kill("SIGTERM");
  }
  processes.length = 0;
});

describe("dev-server", () => {
  test("resolves when waitOnUrl becomes reachable", async () => {
    // Start a simple HTTP server, then wait for it
    const child = await startDevServer({
      command:
        "bun -e \"Bun.serve({ port: 19876, fetch: () => new Response('ok') })\"",
      cwd: process.cwd(),
      waitOnUrl: "http://127.0.0.1:19876",
    });
    processes.push(child);

    expect(child.pid).toBeGreaterThan(0);
  });

  test("rejects when command exits with error", async () => {
    await expect(
      startDevServer({
        command: "exit 1",
        cwd: process.cwd(),
        waitOnUrl: "http://127.0.0.1:19877",
      }),
    ).rejects.toThrow("exited with code");
  });

  test("rejects when command is not found", async () => {
    await expect(
      startDevServer({
        command: "nonexistent-command-xyz-123",
        cwd: process.cwd(),
        waitOnUrl: "http://127.0.0.1:19878",
      }),
    ).rejects.toThrow();
  });
});
