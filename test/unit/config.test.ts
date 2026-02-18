import { describe, expect, test } from "bun:test";
import { parseCliArgs, resolveConfig } from "../../src/config.ts";

describe("parseCliArgs", () => {
  test("parses --url", () => {
    const args = parseCliArgs(["--url=http://localhost:3000"]);
    expect(args.url).toBe("http://localhost:3000");
  });

  test("parses --command", () => {
    const args = parseCliArgs(["--command=pnpm run dev"]);
    expect(args.command).toBe("pnpm run dev");
  });

  test("parses --source", () => {
    const args = parseCliArgs(["--source=./my-app"]);
    expect(args.source).toBe("./my-app");
  });

  test("parses all args together", () => {
    const args = parseCliArgs([
      "--url=http://localhost:3000",
      "--command=pnpm run dev",
      "--source=./my-app",
    ]);
    expect(args.url).toBe("http://localhost:3000");
    expect(args.command).toBe("pnpm run dev");
    expect(args.source).toBe("./my-app");
  });

  test("returns empty object for no args", () => {
    const args = parseCliArgs([]);
    expect(args.url).toBeUndefined();
    expect(args.command).toBeUndefined();
    expect(args.source).toBeUndefined();
  });
});

describe("resolveConfig", () => {
  test("throws if no URL is provided", async () => {
    await expect(resolveConfig({ source: "/nonexistent" })).rejects.toThrow(
      "Dev server URL is required",
    );
  });

  test("resolves with CLI args", async () => {
    const config = await resolveConfig({
      url: "http://localhost:3000",
      command: "pnpm dev",
      source: "/tmp",
    });
    expect(config.devServer.url).toBe("http://localhost:3000");
    expect(config.devServer.command).toBe("pnpm dev");
    expect(config.source).toBe("/tmp");
  });

  test("defaults source to '.'", async () => {
    const config = await resolveConfig({
      url: "http://localhost:3000",
    });
    expect(config.source).toBe(".");
  });
});
