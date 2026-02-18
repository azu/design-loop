import http from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
};

export type UiServerOptions = {
  port: number;
  proxyUrl: string;
  ptyWsUrl: string;
  sourceDir: string;
  appDir?: string;
  allowedOrigin?: string;
};

export async function startUiServer(
  options: UiServerOptions,
): Promise<http.Server> {
  const { port, proxyUrl, ptyWsUrl, sourceDir, appDir, allowedOrigin } = options;
  const uiBaseUrl = `http://127.0.0.1:${port}`;

  // Resolve UI dist directory
  const thisDir = dirname(fileURLToPath(import.meta.url));
  let uiDir = join(thisDir, "..", "dist", "ui");
  let htmlDir = join(thisDir, "..", "src", "ui");

  // Fallback to cwd-relative paths
  try {
    await readFile(join(uiDir, "index.js"));
  } catch {
    uiDir = join(process.cwd(), "dist", "ui");
    htmlDir = join(process.cwd(), "src", "ui");
  }

  const config = JSON.stringify({ proxyUrl, ptyWsUrl, uiBaseUrl, appDir: appDir ?? null });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    const pathname = url.pathname;

    // API: image upload
    if (pathname === "/api/upload-image" && req.method === "POST") {
      // Verify origin
      if (allowedOrigin && req.headers.origin !== allowedOrigin) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }

      try {
        await handleImageUpload(req, res, sourceDir);
      } catch (err) {
        console.error("[design-loop ui] Upload error:", err);
        res.writeHead(500);
        res.end("Upload failed");
      }
      return;
    }

    // API: send to engineer
    if (pathname === "/api/send-to-engineer" && req.method === "POST") {
      if (allowedOrigin && req.headers.origin !== allowedOrigin) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }
      // Will be implemented in Phase 7
      res.writeHead(501);
      res.end(JSON.stringify({ error: "Not yet implemented" }));
      return;
    }

    // Serve index.html with config injection
    if (pathname === "/" || pathname === "/index.html") {
      try {
        let html = await readFile(join(htmlDir, "index.html"), "utf-8");
        // Inject config before </head>
        const configScript = `<script>window.__DESIGN_LOOP_CONFIG__=${config};</script>`;
        html = html.replace("</head>", `${configScript}\n</head>`);
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(html);
      } catch (err) {
        console.error("[design-loop ui] Failed to serve index.html:", err);
        res.writeHead(500);
        res.end("Failed to load UI");
      }
      return;
    }

    // Serve static files from dist/ui
    const ext = extname(pathname);
    const mime = MIME_TYPES[ext] ?? "application/octet-stream";
    try {
      const content = await readFile(join(uiDir, pathname));
      res.writeHead(200, { "content-type": mime });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      resolve(server);
    });
  });
}

async function handleImageUpload(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  sourceDir: string,
): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const body = Buffer.concat(chunks);

  // Parse multipart form data (simple implementation)
  const contentType = req.headers["content-type"] ?? "";
  const boundaryMatch = contentType.match(/boundary=(.+)/);
  if (!boundaryMatch) {
    res.writeHead(400);
    res.end("Missing boundary");
    return;
  }

  const boundary = boundaryMatch[1];
  const parts = parseMultipart(body, boundary);
  const imagePart = parts.find((p) => p.name === "image");

  if (!imagePart || !imagePart.filename) {
    res.writeHead(400);
    res.end("No image found");
    return;
  }

  // Size limit: 20MB
  if (imagePart.data.length > 20 * 1024 * 1024) {
    res.writeHead(413);
    res.end("File too large");
    return;
  }

  // Sanitize filename
  const safeName = imagePart.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const timestamp = Date.now();
  const filename = `${timestamp}_${safeName}`;

  const tmpDir = join(sourceDir, ".design-loop", "tmp");
  await mkdir(tmpDir, { recursive: true });
  const filePath = join(tmpDir, filename);
  await writeFile(filePath, imagePart.data);

  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ path: filePath }));
}

type MultipartPart = {
  name: string;
  filename?: string;
  contentType?: string;
  data: Buffer;
};

function parseMultipart(body: Buffer, boundary: string): MultipartPart[] {
  const parts: MultipartPart[] = [];
  const boundaryBuf = Buffer.from(`--${boundary}`);
  const endBuf = Buffer.from(`--${boundary}--`);

  let start = body.indexOf(boundaryBuf);
  if (start === -1) return parts;

  while (true) {
    start = body.indexOf(boundaryBuf, start);
    if (start === -1) break;

    start += boundaryBuf.length;
    // Skip \r\n after boundary
    if (body[start] === 0x0d && body[start + 1] === 0x0a) {
      start += 2;
    }

    const nextBoundary = body.indexOf(boundaryBuf, start);
    if (nextBoundary === -1) break;

    // Check if this is the end boundary
    const slice = body.subarray(start, nextBoundary);
    if (slice.length === 0) break;

    // Find header/body separator (\r\n\r\n)
    const headerEnd = slice.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd === -1) continue;

    const headerStr = slice.subarray(0, headerEnd).toString("utf-8");
    let data = slice.subarray(headerEnd + 4);

    // Remove trailing \r\n before next boundary
    if (data.length >= 2 && data[data.length - 2] === 0x0d && data[data.length - 1] === 0x0a) {
      data = data.subarray(0, data.length - 2);
    }

    const nameMatch = headerStr.match(/name="([^"]+)"/);
    const filenameMatch = headerStr.match(/filename="([^"]+)"/);
    const ctMatch = headerStr.match(/Content-Type:\s*(.+)/i);

    if (nameMatch) {
      parts.push({
        name: nameMatch[1],
        filename: filenameMatch?.[1],
        contentType: ctMatch?.[1]?.trim(),
        data,
      });
    }
  }

  return parts;
}
