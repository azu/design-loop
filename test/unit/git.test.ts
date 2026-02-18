import { describe, expect, test } from "bun:test";
import { formatBranchName } from "../../src/git.ts";

describe("formatBranchName", () => {
  test("formats branch name with date", () => {
    const date = new Date(2024, 5, 15, 14, 30, 45); // June 15, 2024, 14:30:45
    const name = formatBranchName(date);
    expect(name).toBe("design-loop/2024-06-15-143045");
  });

  test("pads single-digit values", () => {
    const date = new Date(2024, 0, 5, 3, 7, 9); // Jan 5, 2024, 03:07:09
    const name = formatBranchName(date);
    expect(name).toBe("design-loop/2024-01-05-030709");
  });

  test("returns a string starting with design-loop/", () => {
    const name = formatBranchName();
    expect(name.startsWith("design-loop/")).toBe(true);
  });

  test("matches expected pattern", () => {
    const name = formatBranchName();
    expect(name).toMatch(/^design-loop\/\d{4}-\d{2}-\d{2}-\d{6}$/);
  });
});
