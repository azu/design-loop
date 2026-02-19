import { join } from "node:path";
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
      "/api/upload-image": {
        POST: async (req) => {
          if (allowedOrigin && req.headers.get("origin") !== allowedOrigin) {
            return new Response("Forbidden", { status: 403 });
          }
          try {
            return await handleImageUpload(req, sourceDir);
          } catch (err) {
            console.error("[design-loop ui] Upload error:", err);
            return new Response("Upload failed", { status: 500 });
          }
        },
      },
      "/api/send-to-engineer": {
        POST: (req) => {
          if (allowedOrigin && req.headers.get("origin") !== allowedOrigin) {
            return new Response("Forbidden", { status: 403 });
          }
          return Response.json({ error: "Not yet implemented" }, { status: 501 });
        },
      },
    },
    fetch(_req) {
      return new Response("Not found", { status: 404 });
    },
  });

  return server;
}

async function handleImageUpload(
  req: Request,
  sourceDir: string,
): Promise<Response> {
  const formData = await req.formData();
  const imageFile = formData.get("image");

  if (!imageFile || !(imageFile instanceof File)) {
    return new Response("No image found", { status: 400 });
  }

  // Size limit: 20MB
  if (imageFile.size > 20 * 1024 * 1024) {
    return new Response("File too large", { status: 413 });
  }

  // Sanitize filename
  const safeName = (imageFile.name ?? "upload").replace(/[^a-zA-Z0-9._-]/g, "_");
  const timestamp = Date.now();
  const filename = `${timestamp}_${safeName}`;

  const tmpDir = join(sourceDir, ".design-loop", "tmp");
  await mkdir(tmpDir, { recursive: true });
  const filePath = join(tmpDir, filename);
  const arrayBuffer = await imageFile.arrayBuffer();
  await writeFile(filePath, Buffer.from(arrayBuffer));

  return Response.json({ path: filePath });
}
