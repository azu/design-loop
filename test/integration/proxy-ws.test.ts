import { describe, expect, test, afterEach } from "bun:test";
import http from "node:http";
import { startProxyServer } from "../../src/proxy/proxy-server.ts";
import { findFreePort } from "../../src/port.ts";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const tmpDir = join(import.meta.dir, "..", "..", "dist", "ui");

async function ensureInjectScript() {
  await mkdir(tmpDir, { recursive: true });
  await writeFile(
    join(tmpDir, "inject-script.js"),
    'console.log("[design-loop] test inject");',
  );
}

const servers: http.Server[] = [];

afterEach(() => {
  for (const s of servers) s.close();
  servers.length = 0;
});

function createUpstream(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr !== "string") {
        servers.push(server);
        resolve({ server, port: addr.port });
      }
    });
  });
}

// Note: Bun's http.createServer upgrade socket.write() does not deliver data
// to the client (Bun compat issue). In production, the injected WebSocket
// redirect script makes the browser connect directly to upstream, bypassing
// the proxy's raw TCP pipe. So the redirect script injection is the critical
// path to test.

describe("proxy WebSocket redirect", () => {
  test("injects WebSocket redirect script before HTML content", async () => {
    await ensureInjectScript();

    const { port: upstreamPort } = await createUpstream((_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<html><body><h1>App</h1></body></html>");
    });

    const proxyPort = await findFreePort();
    const proxy = await startProxyServer({
      upstream: `http://127.0.0.1:${upstreamPort}`,
      port: proxyPort,
    });
    servers.push(proxy);

    const res = await fetch(`http://127.0.0.1:${proxyPort}/`);
    const body = await res.text();

    // Redirect script is injected
    expect(body).toContain("__DESIGN_LOOP_UPSTREAM__");
    // Upstream origin is correct
    expect(body).toContain(`http://127.0.0.1:${upstreamPort}`);
    // WebSocket constructor is patched
    expect(body).toContain("window.WebSocket=P");
  });

  test("redirect script appears before upstream HTML content", async () => {
    await ensureInjectScript();

    const { port: upstreamPort } = await createUpstream((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html><body><script>new WebSocket('ws://localhost')</script></body></html>");
    });

    const proxyPort = await findFreePort();
    const proxy = await startProxyServer({
      upstream: `http://127.0.0.1:${upstreamPort}`,
      port: proxyPort,
    });
    servers.push(proxy);

    const res = await fetch(`http://127.0.0.1:${proxyPort}/`);
    const body = await res.text();

    const redirectPos = body.indexOf("window.WebSocket=P");
    const appScriptPos = body.indexOf("new WebSocket");
    expect(redirectPos).toBeLessThan(appScriptPos);
  });

  test("redirect script rewrites proxy host to upstream host", async () => {
    await ensureInjectScript();

    const { port: upstreamPort } = await createUpstream((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html><body></body></html>");
    });

    const proxyPort = await findFreePort();
    const proxy = await startProxyServer({
      upstream: `http://127.0.0.1:${upstreamPort}`,
      port: proxyPort,
    });
    servers.push(proxy);

    const res = await fetch(`http://127.0.0.1:${proxyPort}/`);
    const body = await res.text();

    // The script stores the upstream origin for WebSocket rewriting
    expect(body).toContain(`var uo="http://127.0.0.1:${upstreamPort}"`);
  });
});
