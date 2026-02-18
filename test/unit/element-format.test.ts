import { describe, expect, test } from "bun:test";
import { formatElementLabel, type ElementInfo } from "../../src/ui/element-selection.ts";

const baseInfo: ElementInfo = {
  selector: ".card",
  component: null,
  styles: {},
  rect: { top: 0, left: 0, width: 100, height: 50 },
  tagName: "div",
  textContent: null,
  ariaSnapshot: "",
};

describe("formatElementLabel", () => {
  test("formats component with hierarchy and source", () => {
    const info: ElementInfo = {
      ...baseInfo,
      tagName: "button",
      component: {
        name: "Button",
        props: { variant: "primary", size: "l" },
        source: { fileName: "src/Button.tsx", lineNumber: 42, columnNumber: 1 },
        hierarchy: ["App", "Layout"],
      },
      textContent: "Click me",
    };

    const result = formatElementLabel(info);
    expect(result).toContain("Layout > App > Button <button>");
    expect(result).toContain("file: src/Button.tsx:42");
    expect(result).toContain("variant: primary");
    expect(result).toContain("size: l");
    expect(result).toContain('text: "Click me"');
  });

  test("formats component without hierarchy", () => {
    const info: ElementInfo = {
      ...baseInfo,
      tagName: "input",
      component: {
        name: "TextField",
        props: {},
        source: null,
        hierarchy: [],
      },
    };

    const result = formatElementLabel(info);
    expect(result).toContain("TextField <input>");
    expect(result).not.toContain("file:");
  });

  test("formats non-component element with selector", () => {
    const info: ElementInfo = {
      ...baseInfo,
      tagName: "div",
      selector: "#main > .card",
    };

    const result = formatElementLabel(info);
    expect(result).toContain("<div> #main > .card");
  });

  test("includes text content", () => {
    const info: ElementInfo = {
      ...baseInfo,
      tagName: "p",
      textContent: "Hello world",
    };

    const result = formatElementLabel(info);
    expect(result).toContain('text: "Hello world"');
  });

  test("includes aria snapshot", () => {
    const snapshot = "- main\n  - heading \"Title\"\n  - button \"Submit\"";
    const info: ElementInfo = {
      ...baseInfo,
      tagName: "main",
      ariaSnapshot: snapshot,
    };

    const result = formatElementLabel(info);
    expect(result).toContain("---");
    expect(result).toContain(snapshot);
  });

  test("omits text content when null", () => {
    const info: ElementInfo = {
      ...baseInfo,
      textContent: null,
    };

    const result = formatElementLabel(info);
    expect(result).not.toContain("text:");
  });

  test("omits aria snapshot when empty", () => {
    const info: ElementInfo = {
      ...baseInfo,
      ariaSnapshot: "",
    };

    const result = formatElementLabel(info);
    expect(result).not.toContain("---");
  });
});
