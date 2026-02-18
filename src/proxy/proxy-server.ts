import http from "node:http";
import { createConnection } from "node:net";
import { getInjectScript } from "./inject.ts";

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
        if (key.toLowerCase() === "accept-encoding") continue;
        if (key.toLowerCase() === "host") {
          forwardHeaders.set(key, upstreamUrl.host);
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
      const upstreamRes = await fetch(targetUrl.toString(), {
        method: req.method,
        headers: forwardHeaders,
        body: bodyData ? new Uint8Array(bodyData) : undefined,
        redirect: "manual",
      });

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
        // Don't forward content-length for HTML (we modify it)
        if (
          lower === "content-length" &&
          upstreamRes.headers.get("content-type")?.includes("text/html")
        ) {
          return;
        }
        // Don't forward content-encoding since we stripped Accept-Encoding
        if (lower === "content-encoding") return;
        responseHeaders[key] = value;
      });

      const contentType = upstreamRes.headers.get("content-type") ?? "";
      const isHtml = contentType.includes("text/html");

      if (isHtml && upstreamRes.body) {
        // Use HTMLRewriter to inject script into body
        const rewritten = new HTMLRewriter()
          .on("body", {
            element(el: { append: (content: string, options: { html: boolean }) => void }) {
              el.append(
                '<script src="/design-loop-inject.js"></script>',
                { html: true },
              );
            },
          })
          .transform(
            new Response(upstreamRes.body, {
              headers: responseHeaders,
            }),
          );

        res.writeHead(upstreamRes.status, responseHeaders);
        const reader = rewritten.body?.getReader();
        if (reader) {
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
      } else {
        // Non-HTML: stream through unchanged
        res.writeHead(upstreamRes.status, responseHeaders);
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
      console.error("[design-loop proxy] Error:", err);
      if (!res.headersSent) {
        res.writeHead(502);
        res.end("Proxy error");
      }
    }
  });

  // WebSocket passthrough for HMR
  server.on("upgrade", (req, socket, head) => {
    const upstreamPort = parseInt(upstreamUrl.port || "80", 10);
    const upstreamHost = upstreamUrl.hostname;

    const upstreamSocket = createConnection(
      { host: upstreamHost, port: upstreamPort },
      () => {
        // Build raw HTTP upgrade request
        const headers = Object.entries(req.headers)
          .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`)
          .join("\r\n");

        upstreamSocket.write(
          `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${headers}\r\n\r\n`,
        );
        if (head.length > 0) {
          upstreamSocket.write(head);
        }

        // Bidirectional pipe
        socket.pipe(upstreamSocket);
        upstreamSocket.pipe(socket);
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

function readRequestBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
