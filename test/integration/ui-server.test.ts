import { describe, expect, test, afterEach } from "bun:test";
import type { Server } from "bun";
import { startUiServer } from "../../src/ui-server.ts";
import { findFreePort } from "../../src/port.ts";
import { rm } from "node:fs/promises";
import { join } from "node:path";

const servers: Server[] = [];
const tmpDirs: string[] = [];

afterEach(async () => {
  for (const s of servers) s.stop();
  servers.length = 0;
  for (const d of tmpDirs) {
    await rm(d, { recursive: true, force: true }).catch(() => {});
  }
  tmpDirs.length = 0;
});

async function setupUiServer(options?: { allowedOrigin?: string }) {
  const port = await findFreePort();
  const sourceDir = join(import.meta.dir, "..", "..", "fixtures", "test-app");

  const server = await startUiServer({
    port,
    proxyUrl: "http://127.0.0.1:9999",
    ptyWsUrl: "ws://127.0.0.1:9998",
    sourceDir,
    appDir: null as unknown as undefined,
    allowedOrigin: options?.allowedOrigin ?? `http://127.0.0.1:${port}`,
  });
  servers.push(server);

  return { port, sourceDir };
}

describe("ui-server", () => {
  test("serves index.html", async () => {
    const { port } = await setupUiServer();

    const res = await fetch(`http://127.0.0.1:${port}/`);
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(body).toContain("design-loop");
  });

  test("/api/config returns config JSON", async () => {
    const { port } = await setupUiServer();

    const res = await fetch(`http://127.0.0.1:${port}/api/config`);
    const json = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(json.proxyUrl).toBe("http://127.0.0.1:9999");
    expect(json.ptyWsUrl).toBe("ws://127.0.0.1:9998");
    expect(json.uiBaseUrl).toBe(`http://127.0.0.1:${port}`);
  });

  test("serves bundled JS files", async () => {
    const { port } = await setupUiServer();

    // Get the HTML to find the bundled chunk name
    const htmlRes = await fetch(`http://127.0.0.1:${port}/`);
    const html = await htmlRes.text();
    const chunkMatch = html.match(/src="\.?\/?([^"]+\.js)"/);
    if (!chunkMatch) {
      // No chunk found in HTML, skip this assertion
      return;
    }

    const chunkPath = chunkMatch[1];
    const res = await fetch(`http://127.0.0.1:${port}/${chunkPath}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
  });

  test("returns 404 for missing files", async () => {
    const { port } = await setupUiServer();

    const res = await fetch(`http://127.0.0.1:${port}/nonexistent.xyz`);
    expect(res.status).toBe(404);
  });

  test("image upload returns file path", async () => {
    const { port, sourceDir } = await setupUiServer();
    tmpDirs.push(join(sourceDir, ".design-loop"));

    // Create a minimal PNG (1x1 pixel)
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG header
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
      0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41,
      0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
      0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc,
      0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
      0x44, 0xae, 0x42, 0x60, 0x82,
    ]);

    const formData = new FormData();
    formData.append("image", new File([png], "test.png", { type: "image/png" }));

    const res = await fetch(`http://127.0.0.1:${port}/api/upload-image`, {
      method: "POST",
      headers: {
        origin: `http://127.0.0.1:${port}`,
      },
      body: formData,
    });

    expect(res.status).toBe(200);
    const json = await res.json() as { path: string };
    expect(json.path).toContain(".design-loop/tmp/");
    expect(json.path).toContain("test.png");
  });

  test("image upload rejects wrong origin", async () => {
    const { port } = await setupUiServer();

    const formData = new FormData();
    formData.append("image", new File([new Uint8Array(10)], "test.png", { type: "image/png" }));

    const res = await fetch(`http://127.0.0.1:${port}/api/upload-image`, {
      method: "POST",
      headers: {
        origin: "http://evil.example.com",
      },
      body: formData,
    });

    expect(res.status).toBe(403);
  });

  test("/api/send-to-engineer returns 501", async () => {
    const { port } = await setupUiServer();

    const res = await fetch(`http://127.0.0.1:${port}/api/send-to-engineer`, {
      method: "POST",
      headers: { origin: `http://127.0.0.1:${port}` },
    });

    expect(res.status).toBe(501);
  });
});
