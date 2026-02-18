// Element selection script injected into the user's iframe via MITM proxy.
// Built as IIFE (not ESM) to execute immediately.

(() => {
  let selectionMode = false;
  let ignoreSelectors: string[] = [];

  function setStyle(el: HTMLElement, styles: Partial<CSSStyleDeclaration>): void {
    for (const [key, value] of Object.entries(styles)) {
      (el.style as Record<string, unknown>)[key] = value;
    }
  }

  function createStyledElement(
    tag: string,
    id: string,
    styles: Partial<CSSStyleDeclaration>,
  ): HTMLElement {
    const el = document.createElement(tag);
    el.id = id;
    setStyle(el, styles);
    return el;
  }

  const overlay = createStyledElement("div", "design-loop-overlay", {
    position: "fixed",
    pointerEvents: "none",
    zIndex: "2147483647",
    background: "rgba(59, 130, 246, 0.15)",
    border: "2px solid rgba(59, 130, 246, 0.8)",
    borderRadius: "2px",
    display: "none",
    transition: "all 0.05s ease-out",
  });
  document.body.appendChild(overlay);

  const tooltip = createStyledElement("div", "design-loop-tooltip", {
    position: "fixed",
    pointerEvents: "none",
    zIndex: "2147483647",
    background: "rgba(30, 30, 60, 0.9)",
    color: "#e0e0e0",
    padding: "2px 6px",
    fontSize: "11px",
    fontFamily: "monospace",
    borderRadius: "3px",
    display: "none",
    whiteSpace: "nowrap",
  });
  document.body.appendChild(tooltip);

  // Listen for mode toggle from parent frame
  window.addEventListener("message", (e) => {
    if (e.data?.type === "toggle-selection") {
      selectionMode = e.data.enabled;
      document.body.style.cursor = selectionMode ? "crosshair" : "";
      if (!selectionMode) {
        overlay.style.display = "none";
        tooltip.style.display = "none";
      }
    }
    if (e.data?.type === "set-ignore-selectors") {
      ignoreSelectors = e.data.selectors ?? [];
    }
  });

  // Check if element should be ignored
  function shouldIgnore(el: Element): boolean {
    if (el.id === "design-loop-overlay" || el.id === "design-loop-tooltip") {
      return true;
    }
    return ignoreSelectors.some((sel) => {
      try {
        return el.matches(sel);
      } catch {
        return false;
      }
    });
  }

  // Hover highlight
  document.addEventListener(
    "mouseover",
    (e) => {
      if (!selectionMode) return;
      const target = e.target as HTMLElement;
      if (shouldIgnore(target)) return;

      const rect = target.getBoundingClientRect();
      setStyle(overlay, {
        top: `${rect.top}px`,
        left: `${rect.left}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        display: "block",
      });

      // Show tooltip
      const componentInfo = getReactComponentInfo(target);
      const label = componentInfo
        ? `${componentInfo.name} <${target.tagName.toLowerCase()}>`
        : `<${target.tagName.toLowerCase()}>`;
      tooltip.textContent = label;
      tooltip.style.display = "block";
      tooltip.style.top = `${Math.max(0, rect.top - 22)}px`;
      tooltip.style.left = `${rect.left}px`;
    },
    true,
  );

  document.addEventListener(
    "mouseout",
    (e) => {
      if (!selectionMode) return;
      // Only hide if leaving to a non-child element
      const related = e.relatedTarget as HTMLElement | null;
      if (!related || !document.body.contains(related)) {
        overlay.style.display = "none";
        tooltip.style.display = "none";
      }
    },
    true,
  );

  // Click capture
  document.addEventListener(
    "click",
    (e) => {
      if (!selectionMode) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      const target = e.target as HTMLElement;
      if (shouldIgnore(target)) return;

      const rect = target.getBoundingClientRect();
      const info = {
        selector: getCSSSelector(target),
        component: getReactComponentInfo(target),
        styles: getComputedStylesSummary(target),
        rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
        tagName: target.tagName.toLowerCase(),
        textContent: (target.textContent ?? "").slice(0, 100).trim(),
      };

      window.parent.postMessage({ type: "element-selected", payload: info }, "*");
    },
    true,
  );

  // Get unique CSS selector for an element
  function getCSSSelector(el: Element): string {
    if (el.id) return `#${CSS.escape(el.id)}`;

    const parts: string[] = [];
    let current: Element | null = el;

    while (current && current !== document.body) {
      let selector = current.tagName.toLowerCase();

      if (current.id) {
        selector = `#${CSS.escape(current.id)}`;
        parts.unshift(selector);
        break;
      }

      if (current.className && typeof current.className === "string") {
        const classes = current.className
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((c) => `.${CSS.escape(c)}`)
          .join("");
        if (classes) selector += classes;
      }

      // Add nth-child if needed for uniqueness
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          (s) => s.tagName === current!.tagName,
        );
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          selector += `:nth-child(${index})`;
        }
      }

      parts.unshift(selector);
      current = current.parentElement;
    }

    return parts.join(" > ");
  }

  // Get React component info from Fiber
  function getReactComponentInfo(
    el: HTMLElement,
  ): { name: string; source: { fileName: string; lineNumber: number; columnNumber: number } | null } | null {
    const fiberKey = Object.keys(el).find((k) =>
      k.startsWith("__reactFiber$"),
    );
    if (!fiberKey) return null;

    let fiber = (el as Record<string, unknown>)[fiberKey] as {
      type: string | { displayName?: string; name?: string };
      return: typeof fiber | null;
      _debugSource?: { fileName: string; lineNumber: number; columnNumber: number };
    } | null;

    // Walk up from native element to component fiber
    while (fiber && typeof fiber.type === "string") {
      fiber = fiber.return;
    }

    if (!fiber || typeof fiber.type === "string") return null;

    const name =
      (fiber.type as { displayName?: string }).displayName ??
      (fiber.type as { name?: string }).name ??
      "Unknown";

    return {
      name,
      source: fiber._debugSource ?? null,
    };
  }

  // Extract key computed styles
  function getComputedStylesSummary(el: HTMLElement): Record<string, string> {
    const computed = window.getComputedStyle(el);
    const props = [
      "padding",
      "margin",
      "border-radius",
      "background-color",
      "color",
      "font-size",
      "font-weight",
      "width",
      "height",
      "display",
      "gap",
      "flex-direction",
      "justify-content",
      "align-items",
    ];

    const result: Record<string, string> = {};
    for (const prop of props) {
      const value = computed.getPropertyValue(prop);
      // Skip default/empty values
      if (value && value !== "normal" && value !== "none" && value !== "auto") {
        result[prop] = value;
      }
    }
    return result;
  }

  console.log("[design-loop] Element selection script loaded");
})();
