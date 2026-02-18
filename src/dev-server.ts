import { spawn, type ChildProcess } from "node:child_process";

export type DevServerOptions = {
  command: string;
  cwd: string;
  readyPattern?: string;
};

export function startDevServer(
  options: DevServerOptions,
): Promise<ChildProcess> {
  const { command, cwd, readyPattern } = options;

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

    if (readyPattern) {
      const pattern = readyPattern;
      child.stdout?.on("data", (data: Buffer) => {
        const text = data.toString();
        process.stdout.write(`[dev] ${text}`);
        if (text.includes(pattern)) {
          onReady();
        }
      });
    } else {
      // If no pattern, wait for first stdout output
      child.stdout?.once("data", (data: Buffer) => {
        process.stdout.write(`[dev] ${data.toString()}`);
        onReady();
      });
    }

    child.stderr?.on("data", (data: Buffer) => {
      process.stderr.write(`[dev] ${data.toString()}`);
    });

    child.on("error", (err) => {
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });

    child.on("exit", (code) => {
      if (!resolved) {
        resolved = true;
        reject(new Error(`Dev server exited with code ${code}`));
      }
    });

    // Fallback timeout: resolve after 5s even without output
    setTimeout(() => {
      onReady();
    }, 5000);
  });
}
