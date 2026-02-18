import { describe, expect, test, afterEach } from "bun:test";
import http from "node:http";
import { startProxyServer } from "../../src/proxy/proxy-server.ts";
import { findFreePort } from "../../src/port.ts";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

// Create a minimal inject script for testing
const tmpDir = join(import.meta.dir, "..", "..", "dist", "ui");

async function ensureInjectScript() {
  await mkdir(tmpDir, { recursive: true });
  await writeFile(
    join(tmpDir, "inject-script.js"),
    'console.log("[design-loop] test inject");',
  );
}

function createUpstreamServer(
  handler: (
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ) => void,
): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr !== "string") {
        resolve({ server, port: addr.port });
      }
    });
  });
}

const servers: http.Server[] = [];

afterEach(() => {
  for (const server of servers) {
    server.close();
  }
  servers.length = 0;
});

describe("proxy-server", () => {
  test("injects script tag into HTML responses", async () => {
    await ensureInjectScript();

    const { server: upstream, port: upstreamPort } = await createUpstreamServer(
      (_req, res) => {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end("<html><body><h1>Hello</h1></body></html>");
      },
    );
    servers.push(upstream);

    const proxyPort = await findFreePort();
    const proxy = await startProxyServer({
      upstream: `http://127.0.0.1:${upstreamPort}`,
      port: proxyPort,
    });
    servers.push(proxy);

    const res = await fetch(`http://127.0.0.1:${proxyPort}/`);
    const body = await res.text();

    expect(body).toContain('<script src="/design-loop-inject.js"></script>');
    expect(body).toContain("<h1>Hello</h1>");
  });

  test("removes x-frame-options header", async () => {
    const { server: upstream, port: upstreamPort } = await createUpstreamServer(
      (_req, res) => {
        res.writeHead(200, {
          "content-type": "text/html",
          "x-frame-options": "DENY",
        });
        res.end("<html><body></body></html>");
      },
    );
    servers.push(upstream);

    const proxyPort = await findFreePort();
    const proxy = await startProxyServer({
      upstream: `http://127.0.0.1:${upstreamPort}`,
      port: proxyPort,
    });
    servers.push(proxy);

    const res = await fetch(`http://127.0.0.1:${proxyPort}/`);
    expect(res.headers.get("x-frame-options")).toBeNull();
  });

  test("removes content-security-policy header", async () => {
    const { server: upstream, port: upstreamPort } = await createUpstreamServer(
      (_req, res) => {
        res.writeHead(200, {
          "content-type": "text/html",
          "content-security-policy": "default-src 'self'",
        });
        res.end("<html><body></body></html>");
      },
    );
    servers.push(upstream);

    const proxyPort = await findFreePort();
    const proxy = await startProxyServer({
      upstream: `http://127.0.0.1:${upstreamPort}`,
      port: proxyPort,
    });
    servers.push(proxy);

    const res = await fetch(`http://127.0.0.1:${proxyPort}/`);
    expect(res.headers.get("content-security-policy")).toBeNull();
  });

  test("passes non-HTML responses through unchanged", async () => {
    const cssContent = "body { color: red; }";
    const { server: upstream, port: upstreamPort } = await createUpstreamServer(
      (_req, res) => {
        res.writeHead(200, { "content-type": "text/css" });
        res.end(cssContent);
      },
    );
    servers.push(upstream);

    const proxyPort = await findFreePort();
    const proxy = await startProxyServer({
      upstream: `http://127.0.0.1:${upstreamPort}`,
      port: proxyPort,
    });
    servers.push(proxy);

    const res = await fetch(`http://127.0.0.1:${proxyPort}/style.css`);
    const body = await res.text();
    expect(body).toBe(cssContent);
    expect(body).not.toContain("design-loop");
  });

  test("serves inject script at /design-loop-inject.js", async () => {
    await ensureInjectScript();

    const { server: upstream, port: upstreamPort } = await createUpstreamServer(
      (_req, res) => {
        res.writeHead(200);
        res.end("ok");
      },
    );
    servers.push(upstream);

    const proxyPort = await findFreePort();
    const proxy = await startProxyServer({
      upstream: `http://127.0.0.1:${upstreamPort}`,
      port: proxyPort,
    });
    servers.push(proxy);

    const res = await fetch(
      `http://127.0.0.1:${proxyPort}/design-loop-inject.js`,
    );
    const body = await res.text();
    expect(res.headers.get("content-type")).toContain("application/javascript");
    expect(body).toContain("design-loop");
  });

  test("returns 502 when upstream is unreachable", async () => {
    const proxyPort = await findFreePort();
    const proxy = await startProxyServer({
      upstream: "http://127.0.0.1:19999",
      port: proxyPort,
    });
    servers.push(proxy);

    const res = await fetch(`http://127.0.0.1:${proxyPort}/`);
    expect(res.status).toBe(502);
  });
});
