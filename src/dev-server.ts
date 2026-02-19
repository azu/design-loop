import { spawn, type ChildProcess } from "node:child_process";

export type DevServerOptions = {
  command: string;
  cwd: string;
  waitOnUrl: string;
};

const POLL_INTERVAL_MS = 500;
const POLL_TIMEOUT_MS = 30_000;

async function waitForUrl(url: string, signal: AbortSignal): Promise<void> {
  const start = Date.now();
  while (!signal.aborted) {
    try {
      const res = await fetch(url, { signal });
      if (res.ok) return;
    } catch {
      // Server not ready yet
    }
    if (Date.now() - start > POLL_TIMEOUT_MS) {
      throw new Error(`Timed out waiting for ${url} (${POLL_TIMEOUT_MS}ms)`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

export function startDevServer(
  options: DevServerOptions,
): Promise<ChildProcess> {
  const { command, cwd, waitOnUrl } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(command, [], {
      cwd,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let resolved = false;

    const onReady = () => {
      if (resolved) return;
      resolved = true;
      resolve(child);
    };

    const onError = (err: Error) => {
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    };

    child.stdout?.on("data", (data: Buffer) => {
      process.stdout.write(`[dev] ${data.toString()}`);
    });

    child.stderr?.on("data", (data: Buffer) => {
      process.stderr.write(`[dev] ${data.toString()}`);
    });

    child.on("error", onError);

    child.on("exit", (code) => {
      onError(new Error(`Dev server exited with code ${code}`));
    });

    const ac = new AbortController();
    child.on("exit", () => ac.abort());

    waitForUrl(waitOnUrl, ac.signal).then(onReady, onError);
  });
}
