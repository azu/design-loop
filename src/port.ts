import { createServer } from "node:net";

export function findFreePort(): Promise<number> {
  return tryPort(0);
}

/**
 * Try to bind to a specific port. If it's in use, fall back to a random port.
 */
export function tryPort(port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      if (addr === null || typeof addr === "string") {
        server.close(() => reject(new Error("Failed to get port")));
        return;
      }
      const assignedPort = addr.port;
      server.close(() => resolve(assignedPort));
    });
    server.on("error", () => {
      // Port in use, fall back to random
      if (port !== 0) {
        tryPort(0).then(resolve, reject);
      } else {
        reject(new Error("Failed to find free port"));
      }
    });
  });
}
