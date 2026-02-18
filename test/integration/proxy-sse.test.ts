import { describe, expect, test, afterEach } from "bun:test";
import http from "node:http";
import { startProxyServer } from "../../src/proxy/proxy-server.ts";
import { findFreePort } from "../../src/port.ts";

type CleanupFn = () => void;
const cleanups: CleanupFn[] = [];

afterEach(() => {
  for (const fn of cleanups) {
    try { fn(); } catch {}
  }
  cleanups.length = 0;
});

type SseUpstream = {
  server: http.Server;
  port: number;
  emit: (data: string) => void;
};

function createSseUpstream(): Promise<SseUpstream> {
  return new Promise((resolve) => {
    const clients = new Set<http.ServerResponse>();

    const server = http.createServer((req, res) => {
      if (req.url === "/__reload") {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        res.flushHeaders();
        clients.add(res);
        req.on("close", () => clients.delete(res));
        return;
      }
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr !== "string") {
        cleanups.push(() => server.close());
        resolve({
          server,
          port: addr.port,
          emit: (data: string) => {
            for (const res of clients) {
              res.write(`data: ${data}\n\n`);
            }
          },
        });
      }
    });
  });
}

describe("proxy SSE passthrough", () => {
  test("streams SSE events through proxy", async () => {
    const upstream = await createSseUpstream();

    const proxyPort = await findFreePort();
    const proxy = await startProxyServer({
      upstream: `http://127.0.0.1:${upstream.port}`,
      port: proxyPort,
    });
    cleanups.push(() => proxy.close());

    const controller = new AbortController();
    cleanups.push(() => controller.abort());

    const res = await fetch(`http://127.0.0.1:${proxyPort}/__reload`, {
      signal: controller.signal,
    });

    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const reader = res.body!.getReader();

    // Give time for the upstream to register the proxied connection
    await new Promise((r) => setTimeout(r, 200));

    upstream.emit("reload");

    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain("data: reload");
  }, 10000);

  test("client disconnect does not crash proxy", async () => {
    const upstream = await createSseUpstream();

    const proxyPort = await findFreePort();
    const proxy = await startProxyServer({
      upstream: `http://127.0.0.1:${upstream.port}`,
      port: proxyPort,
    });
    cleanups.push(() => proxy.close());

    // Connect and abort
    const controller = new AbortController();
    await fetch(`http://127.0.0.1:${proxyPort}/__reload`, {
      signal: controller.signal,
    });
    await new Promise((r) => setTimeout(r, 100));
    controller.abort();
    await new Promise((r) => setTimeout(r, 300));

    // Proxy should still be alive
    const healthRes = await fetch(`http://127.0.0.1:${proxyPort}/`);
    expect(healthRes.status).toBeGreaterThanOrEqual(200);
  }, 10000);

  test("reconnect after disconnect receives new events", async () => {
    const upstream = await createSseUpstream();

    const proxyPort = await findFreePort();
    const proxy = await startProxyServer({
      upstream: `http://127.0.0.1:${upstream.port}`,
      port: proxyPort,
    });
    cleanups.push(() => proxy.close());

    // First connection then disconnect
    const controller1 = new AbortController();
    await fetch(`http://127.0.0.1:${proxyPort}/__reload`, {
      signal: controller1.signal,
    });
    await new Promise((r) => setTimeout(r, 100));
    controller1.abort();
    await new Promise((r) => setTimeout(r, 300));

    // Reconnect
    const controller2 = new AbortController();
    cleanups.push(() => controller2.abort());

    const res2 = await fetch(`http://127.0.0.1:${proxyPort}/__reload`, {
      signal: controller2.signal,
    });
    const reader = res2.body!.getReader();

    await new Promise((r) => setTimeout(r, 200));

    upstream.emit("after-reconnect");

    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain("data: after-reconnect");
  }, 10000);
});
