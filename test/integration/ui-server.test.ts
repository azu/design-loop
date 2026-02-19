import { describe, expect, test, afterEach } from "bun:test";
import type { Server } from "bun";
import { startUiServer } from "../../src/ui-server.ts";
import { findFreePort } from "../../src/port.ts";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

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

  test("file upload returns file paths", async () => {
    const { port, sourceDir } = await setupUiServer();
    tmpDirs.push(join(tmpdir(), "design-loop"));

    const formData = new FormData();
    formData.append("file", new File([new Uint8Array(10)], "test.png", { type: "image/png" }));

    const res = await fetch(`http://127.0.0.1:${port}/api/upload-file`, {
      method: "POST",
      headers: {
        origin: `http://127.0.0.1:${port}`,
      },
      body: formData,
    });

    expect(res.status).toBe(200);
    const json = await res.json() as { paths: string[] };
    expect(json.paths).toHaveLength(1);
    expect(json.paths[0]).toContain("design-loop/tmp/");
    expect(json.paths[0]).toContain("test.png");
  });

  test("file upload accepts non-image files", async () => {
    const { port, sourceDir } = await setupUiServer();
    tmpDirs.push(join(tmpdir(), "design-loop"));

    const formData = new FormData();
    formData.append("file", new File(["hello world"], "doc.txt", { type: "text/plain" }));

    const res = await fetch(`http://127.0.0.1:${port}/api/upload-file`, {
      method: "POST",
      headers: {
        origin: `http://127.0.0.1:${port}`,
      },
      body: formData,
    });

    expect(res.status).toBe(200);
    const json = await res.json() as { paths: string[] };
    expect(json.paths[0]).toContain("doc.txt");
  });

  test("file upload supports multiple files", async () => {
    const { port, sourceDir } = await setupUiServer();
    tmpDirs.push(join(tmpdir(), "design-loop"));

    const formData = new FormData();
    formData.append("file", new File([new Uint8Array(10)], "a.txt", { type: "text/plain" }));
    formData.append("file", new File([new Uint8Array(20)], "b.pdf", { type: "application/pdf" }));

    const res = await fetch(`http://127.0.0.1:${port}/api/upload-file`, {
      method: "POST",
      headers: {
        origin: `http://127.0.0.1:${port}`,
      },
      body: formData,
    });

    expect(res.status).toBe(200);
    const json = await res.json() as { paths: string[] };
    expect(json.paths).toHaveLength(2);
    expect(json.paths[0]).toContain("a.txt");
    expect(json.paths[1]).toContain("b.pdf");
  });

  test("file upload rejects wrong origin", async () => {
    const { port } = await setupUiServer();

    const formData = new FormData();
    formData.append("file", new File([new Uint8Array(10)], "test.png", { type: "image/png" }));

    const res = await fetch(`http://127.0.0.1:${port}/api/upload-file`, {
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
