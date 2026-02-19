import { describe, expect, test, mock, beforeEach } from "bun:test";

// Test version comparison logic directly
describe("update", () => {
  // Inline compareVersions for unit testing (mirrors src/update.ts logic)
  function compareVersions(a: string, b: string): number {
    const partsA = a.split(".").map(Number);
    const partsB = b.split(".").map(Number);
    const len = Math.max(partsA.length, partsB.length);
    for (let i = 0; i < len; i++) {
      const numA = partsA[i] ?? 0;
      const numB = partsB[i] ?? 0;
      if (numA !== numB) return numA - numB;
    }
    return 0;
  }

  function parseVersion(tag: string): string {
    return tag.replace(/^v/, "");
  }

  describe("compareVersions", () => {
    test("equal versions return 0", () => {
      expect(compareVersions("0.1.0", "0.1.0")).toBe(0);
    });

    test("newer major version returns positive", () => {
      expect(compareVersions("1.0.0", "0.1.0")).toBeGreaterThan(0);
    });

    test("newer minor version returns positive", () => {
      expect(compareVersions("0.2.0", "0.1.0")).toBeGreaterThan(0);
    });

    test("newer patch version returns positive", () => {
      expect(compareVersions("0.1.1", "0.1.0")).toBeGreaterThan(0);
    });

    test("older version returns negative", () => {
      expect(compareVersions("0.1.0", "0.2.0")).toBeLessThan(0);
    });

    test("handles different length versions", () => {
      expect(compareVersions("1.0", "1.0.0")).toBe(0);
      expect(compareVersions("1.0.1", "1.0")).toBeGreaterThan(0);
    });
  });

  describe("parseVersion", () => {
    test("strips v prefix", () => {
      expect(parseVersion("v0.2.0")).toBe("0.2.0");
    });

    test("handles version without prefix", () => {
      expect(parseVersion("0.2.0")).toBe("0.2.0");
    });
  });
});
