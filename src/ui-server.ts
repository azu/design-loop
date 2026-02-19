import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdir, writeFile } from "node:fs/promises";
import index from "./ui/index.html";

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
): Promise<ReturnType<typeof Bun.serve>> {
  const { port, proxyUrl, ptyWsUrl, sourceDir, appDir, allowedOrigin } = options;
  const uiBaseUrl = `http://127.0.0.1:${port}`;

  const server = Bun.serve({
    port,
    hostname: "127.0.0.1",
    routes: {
      "/": index,
      "/api/config": {
        GET: () => Response.json({ proxyUrl, ptyWsUrl, uiBaseUrl, appDir: appDir ?? null }),
      },
      "/api/upload-file": {
        POST: async (req) => {
          if (allowedOrigin && req.headers.get("origin") !== allowedOrigin) {
            return new Response("Forbidden", { status: 403 });
          }
          try {
            return await handleFileUpload(req, sourceDir);
          } catch (err) {
            console.error("[design-loop ui] Upload error:", err);
            return new Response("Upload failed", { status: 500 });
          }
        },
      },
    },
    fetch(_req) {
      return new Response("Not found", { status: 404 });
    },
  });

  return server;
}

async function handleFileUpload(
  req: Request,
  sourceDir: string,
): Promise<Response> {
  const formData = await req.formData();

  const files = formData.getAll("file");
  const validFiles = files.filter((f): f is File => f instanceof File);
  if (validFiles.length === 0) {
    return new Response("No files found", { status: 400 });
  }

  const tmpDir = join(tmpdir(), "design-loop", "tmp");
  await mkdir(tmpDir, { recursive: true });

  const timestamp = Date.now();
  const paths: string[] = [];

  for (const file of validFiles) {
    // Size limit: 20MB per file
    if (file.size > 20 * 1024 * 1024) {
      return new Response(`File too large: ${file.name}`, { status: 413 });
    }

    const safeName = (file.name ?? "upload").replace(/[^a-zA-Z0-9._-]/g, "_");
    const filename = `${timestamp}_${safeName}`;
    const filePath = join(tmpDir, filename);
    const arrayBuffer = await file.arrayBuffer();
    await writeFile(filePath, Buffer.from(arrayBuffer));
    paths.push(filePath);
  }

  return Response.json({ paths });
}
