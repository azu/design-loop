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
  test("resolves when command outputs to stdout", async () => {
    const child = await startDevServer({
      command: "echo 'server started'",
      cwd: process.cwd(),
    });
    processes.push(child);

    expect(child.pid).toBeGreaterThan(0);
  });

  test("resolves when readyPattern is matched", async () => {
    const child = await startDevServer({
      command: "echo 'Loading...' && sleep 0.1 && echo 'Ready on port 3000'",
      cwd: process.cwd(),
      readyPattern: "Ready on port",
    });
    processes.push(child);

    expect(child.pid).toBeGreaterThan(0);
  });

  test("rejects when command exits with error", async () => {
    await expect(
      startDevServer({
        command: "exit 1",
        cwd: process.cwd(),
      }),
    ).rejects.toThrow("exited with code");
  });

  test("rejects when command is not found", async () => {
    await expect(
      startDevServer({
        command: "nonexistent-command-xyz-123",
        cwd: process.cwd(),
      }),
    ).rejects.toThrow();
  });
});
