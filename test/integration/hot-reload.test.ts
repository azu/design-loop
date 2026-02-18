import { describe, expect, test, afterEach } from "bun:test";
import http from "node:http";
import { watch, type FSWatcher } from "node:fs";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { startProxyServer } from "../../src/proxy/proxy-server.ts";
import { findFreePort } from "../../src/port.ts";

type CleanupFn = () => void;
const cleanups: CleanupFn[] = [];

afterEach(async () => {
  for (const fn of cleanups) {
    try { fn(); } catch {}
  }
  cleanups.length = 0;
});

/**
 * Create an upstream server that mimics the test-app:
 * - Serves HTML at /
 * - SSE endpoint at /__reload that emits "reload" on file changes
 */
function createHotReloadUpstream(watchDir: string): Promise<{
  server: http.Server;
  port: number;
}> {
  return new Promise((resolve) => {
    const clients = new Set<http.ServerResponse>();
    let watcher: FSWatcher | null = null;

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

      res.writeHead(200, { "content-type": "text/html" });
      res.end('<html><body><h1>Hot Reload App</h1><script>new EventSource("/__reload").onmessage=()=>location.reload()</script></body></html>');
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr !== "string") {
        // Watch directory for changes
        watcher = watch(watchDir, { recursive: true }, () => {
          for (const client of clients) {
            client.write("data: reload\n\n");
          }
        });

        cleanups.push(() => {
          watcher?.close();
          server.close();
        });
        resolve({ server, port: addr.port });
      }
    });
  });
}

const tmpBase = join(import.meta.dir, "..", "..", ".tmp-hot-reload-test");

describe("hot reload through proxy", () => {
  test("file change triggers SSE event through proxy", async () => {
    const watchDir = join(tmpBase, `test-${Date.now()}`);
    await mkdir(watchDir, { recursive: true });
    cleanups.push(() => { rm(watchDir, { recursive: true, force: true }).catch(() => {}); });

    // Write initial file
    await writeFile(join(watchDir, "index.html"), "<h1>v1</h1>");

    const upstream = await createHotReloadUpstream(watchDir);
    const proxyPort = await findFreePort();
    const proxy = await startProxyServer({
      upstream: `http://127.0.0.1:${upstream.port}`,
      port: proxyPort,
    });
    cleanups.push(() => proxy.close());

    // Connect to SSE through proxy
    const controller = new AbortController();
    cleanups.push(() => controller.abort());

    const res = await fetch(`http://127.0.0.1:${proxyPort}/__reload`, {
      signal: controller.signal,
    });
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const reader = res.body!.getReader();

    // Wait for SSE connection to be established
    await new Promise((r) => setTimeout(r, 300));

    // Trigger file change
    await writeFile(join(watchDir, "index.html"), "<h1>v2</h1>");

    // Read SSE event
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain("data: reload");
  }, 10000);

  test("HTML served through proxy contains reload script", async () => {
    const watchDir = join(tmpBase, `test-html-${Date.now()}`);
    await mkdir(watchDir, { recursive: true });
    cleanups.push(() => { rm(watchDir, { recursive: true, force: true }).catch(() => {}); });

    const upstream = await createHotReloadUpstream(watchDir);
    const proxyPort = await findFreePort();
    const proxy = await startProxyServer({
      upstream: `http://127.0.0.1:${upstream.port}`,
      port: proxyPort,
    });
    cleanups.push(() => proxy.close());

    const res = await fetch(`http://127.0.0.1:${proxyPort}/`);
    const body = await res.text();

    // Upstream's reload script is preserved
    expect(body).toContain("__reload");
    // Proxy's WebSocket redirect is injected
    expect(body).toContain("__DESIGN_LOOP_UPSTREAM__");
    // Inject script is appended
    expect(body).toContain("design-loop-inject.js");
  }, 10000);

  test("multiple file changes produce multiple SSE events", async () => {
    const watchDir = join(tmpBase, `test-multi-${Date.now()}`);
    await mkdir(watchDir, { recursive: true });
    cleanups.push(() => { rm(watchDir, { recursive: true, force: true }).catch(() => {}); });

    await writeFile(join(watchDir, "app.css"), "body{}");

    const upstream = await createHotReloadUpstream(watchDir);
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
    const reader = res.body!.getReader();

    await new Promise((r) => setTimeout(r, 300));

    // First change
    await writeFile(join(watchDir, "app.css"), "body{color:red}");
    const { value: v1 } = await reader.read();
    expect(new TextDecoder().decode(v1)).toContain("data: reload");

    // Wait before second change to ensure distinct events
    await new Promise((r) => setTimeout(r, 300));

    // Second change
    await writeFile(join(watchDir, "app.css"), "body{color:blue}");
    const { value: v2 } = await reader.read();
    expect(new TextDecoder().decode(v2)).toContain("data: reload");
  }, 15000);
});
