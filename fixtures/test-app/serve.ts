import { watch } from "node:fs";
import { join } from "node:path";

const dir = import.meta.dir;
const clients = new Set<ReadableStreamDefaultController>();

// File watcher → notify SSE clients
watch(dir, { recursive: true }, () => {
  for (const client of clients) {
    try {
      client.enqueue("data: reload\n\n");
    } catch {
      clients.delete(client);
    }
  }
});

const server = Bun.serve({
  port: 3456,
  idleTimeout: 255,
  async fetch(req) {
    const url = new URL(req.url);

    // SSE endpoint for live reload
    if (url.pathname === "/__reload") {
      const stream = new ReadableStream({
        start(controller) {
          clients.add(controller);
          req.signal.addEventListener("abort", () => {
            clients.delete(controller);
          });
        },
      });
      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        },
      });
    }

    // Serve static files
    const path = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = Bun.file(join(dir, path));
    if (await file.exists()) {
      let content = await file.text();
      // Inject reload script into HTML
      if (path.endsWith(".html")) {
        content = content.replace(
          "</body>",
          `<script>new EventSource("/__reload").onmessage=()=>location.reload()</script></body>`,
        );
      }
      return new Response(content, {
        headers: { "content-type": file.type },
      });
    }
    return new Response("Not found", { status: 404 });
  },
});

console.log(`Test app: http://localhost:${server.port} (hot reload enabled)`);
