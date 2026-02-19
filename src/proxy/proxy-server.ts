import http from "node:http";
import { createConnection } from "node:net";
import { getInjectScript } from "./inject.ts";
import { logger } from "../logger.ts";

export type ProxyServerOptions = {
  upstream: string;
  port: number;
  allowedOrigin?: string;
};

export async function startProxyServer(
  options: ProxyServerOptions,
): Promise<http.Server> {
  const { upstream, port, allowedOrigin } = options;
  const upstreamUrl = new URL(upstream);
  const proxyOrigin = `http://127.0.0.1:${port}`;

  const server = http.createServer(async (req, res) => {
    // Serve the inject script
    if (req.url === "/design-loop-inject.js") {
      try {
        const script = await getInjectScript();
        res.writeHead(200, {
          "content-type": "application/javascript; charset=utf-8",
          "cache-control": "no-cache",
        });
        res.end(script);
      } catch (err) {
        res.writeHead(500);
        res.end("Failed to load inject script");
      }
      return;
    }

    try {
      const targetUrl = new URL(req.url ?? "/", upstream);

      // Build headers, stripping Accept-Encoding for uncompressed response
      const forwardHeaders = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        const lower = key.toLowerCase();
        if (lower === "accept-encoding") continue;
        if (lower === "host") {
          forwardHeaders.set(key, upstreamUrl.host);
          continue;
        }
        // Rewrite referer/origin to upstream so the app doesn't reject requests
        if (lower === "referer" || lower === "origin") {
          if (value !== undefined) {
            const rewritten = String(value).replace(proxyOrigin, upstream.replace(/\/$/, ""));
            forwardHeaders.set(key, rewritten);
          }
          continue;
        }
        if (value !== undefined) {
          forwardHeaders.set(key, Array.isArray(value) ? value.join(", ") : value);
        }
      }

      const bodyData =
        req.method !== "GET" && req.method !== "HEAD"
          ? await readRequestBody(req)
          : undefined;

      // Abort upstream fetch when client disconnects (e.g. SSE reconnect)
      const abortController = new AbortController();
      res.on("close", () => abortController.abort());

      const upstreamRes = await fetch(targetUrl.toString(), {
        method: req.method,
        headers: forwardHeaders,
        body: bodyData ? new Uint8Array(bodyData) : undefined,
        redirect: "manual",
        signal: abortController.signal,
      });

      logger.debug(`[design-loop proxy] ${req.method} ${req.url} → ${upstreamRes.status} (${upstreamRes.headers.get("content-type") ?? "no content-type"})`);

      // Build response headers, removing iframe-blocking ones
      const responseHeaders: Record<string, string> = {};
      upstreamRes.headers.forEach((value, key) => {
        const lower = key.toLowerCase();
        if (
          lower === "x-frame-options" ||
          lower === "content-security-policy" ||
          lower === "content-security-policy-report-only"
        ) {
          return;
        }
        // Don't forward content-length: Bun's fetch() auto-decompresses
        // responses, so the original Content-Length (compressed size) is wrong
        if (lower === "content-length") return;
        // Don't forward content-encoding since we stripped Accept-Encoding
        if (lower === "content-encoding") return;
        // Rewrite Location header to keep traffic through the proxy
        if (lower === "location") {
          responseHeaders[key] = rewriteLocationHeader(value, upstreamUrl, proxyOrigin);
          return;
        }
        // Rewrite Set-Cookie domain to proxy
        if (lower === "set-cookie") {
          responseHeaders[key] = value.replace(
            new RegExp(`domain=${escapeRegExp(upstreamUrl.hostname)}`, "gi"),
            `domain=127.0.0.1`,
          );
          return;
        }
        responseHeaders[key] = value;
      });

      const contentType = upstreamRes.headers.get("content-type") ?? "";
      const isHtml = contentType.includes("text/html");

      if (isHtml) {
        // Stream HTML through and append inject script at the end.
        // Don't buffer with text() — upstream may use SSR streaming (React 18/Next.js App Router).
        delete responseHeaders["content-length"];
        delete responseHeaders["Content-Length"];
        res.writeHead(upstreamRes.status, responseHeaders);

        // Inject WebSocket redirect BEFORE any upstream content.
        // Must run before Next.js/webpack scripts create HMR connections,
        // otherwise the patch comes too late.
        const upstreamOrigin = `${upstreamUrl.protocol}//${upstreamUrl.host}`;
        res.write(`<script>
(function(){
  var uo="${upstreamOrigin}",ph=location.host,uh=new URL(uo).host,O=window.WebSocket;
  window.__DESIGN_LOOP_UPSTREAM__=uo;
  function P(u,p){try{var r=new URL(u,location.href);if(r.host===ph){r.host=uh;return new O(r.href,p)}}catch(e){}return new O(u,p)}
  P.prototype=O.prototype;P.CONNECTING=O.CONNECTING;P.OPEN=O.OPEN;P.CLOSING=O.CLOSING;P.CLOSED=O.CLOSED;
  window.WebSocket=P;
})();
</script>`);

        if (upstreamRes.body) {
          const reader = upstreamRes.body.getReader();
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              res.write(value);
            }
          } finally {
            reader.releaseLock();
          }
        }
        // Append element selection script after all content
        res.write('<script src="/design-loop-inject.js"></script>');
        res.end();
      } else {
        // Non-HTML: stream through unchanged
        res.writeHead(upstreamRes.status, responseHeaders);
        // Flush headers immediately for long-lived streams (SSE, etc.)
        res.flushHeaders();
        if (upstreamRes.body) {
          const reader = upstreamRes.body.getReader();
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              res.write(value);
            }
          } finally {
            reader.releaseLock();
          }
        }
        res.end();
      }
    } catch (err) {
      // Ignore abort errors (client disconnected, e.g. SSE reconnect)
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (err instanceof Error && err.name === "AbortError") return;
      logger.debug(`[design-loop proxy] ${req.method} ${req.url} → Error:`, err);
      if (!res.headersSent) {
        res.writeHead(502);
        res.end("Proxy error");
      }
    }
  });

  // WebSocket passthrough for HMR
  server.on("upgrade", (req, socket, head) => {
    logger.debug(`[design-loop proxy] WebSocket upgrade: ${req.url}`);
    const upstreamPort = parseInt(upstreamUrl.port || "80", 10);
    const upstreamHost = upstreamUrl.hostname;

    const upstreamSocket = createConnection(
      { host: upstreamHost, port: upstreamPort },
      () => {
        logger.debug(`[design-loop proxy] WebSocket connected to upstream ${upstreamHost}:${upstreamPort}`);

        // Disable Nagle for real-time forwarding
        socket.setNoDelay(true);
        upstreamSocket.setNoDelay(true);

        // Rewrite Host header to upstream
        const headers = Object.entries(req.headers)
          .map(([k, v]) => {
            if (k.toLowerCase() === "host") return `${k}: ${upstreamUrl.host}`;
            if (k.toLowerCase() === "origin") return `${k}: ${upstream.replace(/\/$/, "")}`;
            return `${k}: ${Array.isArray(v) ? v.join(", ") : v}`;
          })
          .join("\r\n");

        upstreamSocket.write(
          `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${headers}\r\n\r\n`,
        );
        if (head.length > 0) {
          upstreamSocket.write(head);
        }

        // Bidirectional pipe
        upstreamSocket.on("data", (chunk) => {
          socket.write(chunk);
        });
        socket.on("data", (chunk) => {
          upstreamSocket.write(chunk);
        });

        upstreamSocket.on("end", () => {
          console.log("[design-loop proxy] WebSocket upstream ended");
          socket.end();
        });
        socket.on("end", () => {
          console.log("[design-loop proxy] WebSocket client ended");
          upstreamSocket.end();
        });
      },
    );

    upstreamSocket.on("error", (err) => {
      console.error("[design-loop proxy] WebSocket upstream error:", err);
      socket.destroy();
    });

    socket.on("error", (err) => {
      console.error("[design-loop proxy] WebSocket client error:", err);
      upstreamSocket.destroy();
    });
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      resolve(server);
    });
  });
}

/**
 * Rewrite Location header: replace upstream origin with proxy origin
 * so redirects stay within the proxy.
 */
function rewriteLocationHeader(location: string, upstreamUrl: URL, proxyOrigin: string): string {
  const upstreamOrigin = `${upstreamUrl.protocol}//${upstreamUrl.host}`;
  // Absolute URL pointing to upstream → rewrite to proxy
  if (location.startsWith(upstreamOrigin)) {
    return proxyOrigin + location.slice(upstreamOrigin.length);
  }
  // Relative URL → fine as-is (browser resolves relative to proxy)
  return location;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readRequestBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
