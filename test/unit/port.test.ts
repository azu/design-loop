import { describe, expect, test } from "bun:test";
import { findFreePort } from "../../src/port.ts";

describe("findFreePort", () => {
  test("returns a valid port number", async () => {
    const port = await findFreePort();
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThanOrEqual(65535);
  });

  test("returns different ports on consecutive calls", async () => {
    const port1 = await findFreePort();
    const port2 = await findFreePort();
    expect(port1).not.toBe(port2);
  });
});
