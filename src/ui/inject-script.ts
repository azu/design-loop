// Element selection script injected into the user's iframe via MITM proxy.
// Built as IIFE (not ESM) to execute immediately.

(() => {
  let selectionMode = false;
  let ignoreSelectors: string[] = [];

  function setStyle(el: HTMLElement, styles: Partial<CSSStyleDeclaration>): void {
    for (const [key, value] of Object.entries(styles)) {
      const kebab = key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
      el.style.setProperty(kebab, typeof value === "string" ? value : "");
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
      const textSnippet = getTextSnippet(target);
      const textPart = textSnippet ? ` "${textSnippet}"` : "";
      let propsPart = "";
      if (componentInfo) {
        const entries = Object.entries(componentInfo.props).slice(0, 3);
        if (entries.length > 0) {
          propsPart = " " + entries.map(([k, v]) => `${k}="${v}"`).join(" ");
        }
      }
      const label = componentInfo
        ? `${componentInfo.name}${propsPart}${textPart} <${target.tagName.toLowerCase()}>`
        : `<${target.tagName.toLowerCase()}>${textPart}`;
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
        ariaSnapshot: buildAriaSnapshot(target),
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

  type FiberNode = {
    type: string | { displayName?: string; name?: string };
    return: FiberNode | null;
    pendingProps?: Record<string, unknown>;
    memoizedProps?: Record<string, unknown>;
    _debugSource?: { fileName: string; lineNumber: number; columnNumber: number };
    _debugOwner?: FiberNode | null;
  };

  type ComponentInfo = {
    name: string;
    props: Record<string, string>;
    source: { fileName: string; lineNumber: number; columnNumber: number } | null;
    hierarchy: string[];
  };

  // Get React component info from Fiber
  function getReactComponentInfo(el: HTMLElement): ComponentInfo | null {
    const fiberKey = Object.keys(el).find((k) =>
      k.startsWith("__reactFiber$"),
    );
    if (!fiberKey) return null;

    let fiber: FiberNode | null = Reflect.get(el, fiberKey) ?? null;

    // Walk up from native element to component fiber
    while (fiber && (!fiber.type || typeof fiber.type === "string")) {
      fiber = fiber.return;
    }

    if (!fiber || !fiber.type || typeof fiber.type === "string") return null;

    const name = getFiberName(fiber);

    // Walk up to find source if current fiber doesn't have it
    let source = fiber._debugSource ?? null;
    if (!source) {
      let walker: FiberNode | null = fiber.return;
      while (walker && !source) {
        if (typeof walker.type !== "string" && walker._debugSource) {
          source = walker._debugSource;
        }
        walker = walker.return;
      }
    }

    // Build component hierarchy (walk up fiber tree)
    const hierarchy: string[] = [];
    let parent: FiberNode | null = fiber.return;
    while (parent && hierarchy.length < 5) {
      if (typeof parent.type !== "string") {
        const pName = getFiberName(parent);
        // Skip internal React wrappers
        if (pName && !isInternalComponent(pName)) {
          hierarchy.push(pName);
        }
      }
      parent = parent.return;
    }

    // Merge fiber props + DOM attributes
    const props = extractSerializableProps(fiber);
    addDomAttributes(el, props);

    return { name, props, source, hierarchy };
  }

  function getFiberName(fiber: FiberNode): string {
    if (!fiber.type) return "Unknown";
    if (typeof fiber.type === "string") return fiber.type;
    return (
      (fiber.type as { displayName?: string }).displayName ??
      (fiber.type as { name?: string }).name ??
      "Unknown"
    );
  }

  function isInternalComponent(name: string): boolean {
    // Skip React internals and common wrappers
    return /^(Suspense|Fragment|Provider|Consumer|Context|Lazy|Memo|ForwardRef|StrictMode)$/i.test(name);
  }

  // Extract serializable props from fiber
  function extractSerializableProps(fiber: FiberNode): Record<string, string> {
    const raw = fiber.pendingProps ?? fiber.memoizedProps;
    if (!raw) return {};

    const result: Record<string, string> = {};
    let count = 0;
    for (const [key, value] of Object.entries(raw)) {
      if (count >= 10) break;
      if (key === "children" || key === "key" || key === "ref") continue;
      if (key.startsWith("on") || key.startsWith("__")) continue;
      const t = typeof value;
      if (t === "string") {
        result[key] = String(value).length > 50 ? String(value).slice(0, 50) + "..." : String(value);
        count++;
      } else if (t === "number" || t === "boolean") {
        result[key] = String(value);
        count++;
      }
    }
    return result;
  }

  // Add useful DOM attributes that might not be in fiber props
  function addDomAttributes(el: HTMLElement, props: Record<string, string>): void {
    // className (useful for CSS framework identification like Tailwind, Panda CSS)
    if (!props["className"] && el.className && typeof el.className === "string") {
      const cls = el.className.trim();
      if (cls) {
        props["className"] = cls.length > 80 ? cls.slice(0, 80) + "..." : cls;
      }
    }

    // data-* attributes
    for (const attr of el.attributes) {
      if (attr.name.startsWith("data-") && !attr.name.startsWith("data-reactid")) {
        const key = attr.name;
        if (!props[key]) {
          props[key] = attr.value.length > 50 ? attr.value.slice(0, 50) + "..." : attr.value;
        }
      }
    }

    // aria-label (useful for identifying purpose)
    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel && !props["aria-label"]) {
      props["aria-label"] = ariaLabel;
    }

    // role
    const role = el.getAttribute("role");
    if (role && !props["role"]) {
      props["role"] = role;
    }
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

  // Report current URL to parent frame
  function reportUrl(): void {
    window.parent.postMessage(
      { type: "page-url", url: location.href, pathname: location.pathname },
      "*",
    );
  }

  // Report on load
  reportUrl();

  // Report on SPA navigation (pushState/replaceState/popstate)
  const origPushState = history.pushState.bind(history);
  const origReplaceState = history.replaceState.bind(history);
  history.pushState = (...args: Parameters<typeof history.pushState>) => {
    origPushState(...args);
    reportUrl();
  };
  history.replaceState = (...args: Parameters<typeof history.replaceState>) => {
    origReplaceState(...args);
    reportUrl();
  };
  window.addEventListener("popstate", reportUrl);

  // Build an aria snapshot tree around the selected element
  function buildAriaSnapshot(target: HTMLElement): string {
    // Find a meaningful ancestor to use as root (landmark or max 3 levels up)
    let root: HTMLElement = target;
    const landmarks = ["main", "nav", "header", "footer", "aside", "section", "article", "form", "dialog"];
    let parent = target.parentElement;
    let depth = 0;
    while (parent && depth < 5) {
      const role = getEffectiveRole(parent);
      if (role && landmarks.includes(role)) {
        root = parent;
        break;
      }
      root = parent;
      parent = parent.parentElement;
      depth++;
    }

    const lines: string[] = [];
    walkAriaTree(root, target, 0, lines, 0);
    return lines.join("\n");
  }

  function walkAriaTree(
    el: Element,
    target: Element,
    indent: number,
    lines: string[],
    depth: number,
  ): void {
    if (depth > 6 || lines.length > 30) return;
    if (shouldIgnore(el as HTMLElement)) return;

    const role = getEffectiveRole(el as HTMLElement);
    const name = getAccessibleName(el as HTMLElement);
    const isTarget = el === target;

    if (role || isTarget) {
      const prefix = "  ".repeat(indent);
      const marker = isTarget ? " ← selected" : "";
      const attrs: string[] = [];

      // Add useful attributes
      if (el.tagName === "H1" || el.tagName === "H2" || el.tagName === "H3" ||
          el.tagName === "H4" || el.tagName === "H5" || el.tagName === "H6") {
        attrs.push(`level=${el.tagName[1]}`);
      }
      if ((el as HTMLElement).getAttribute("aria-current")) {
        attrs.push(`current="${(el as HTMLElement).getAttribute("aria-current")}"`);
      }
      if ((el as HTMLElement).getAttribute("aria-expanded")) {
        attrs.push(`expanded=${(el as HTMLElement).getAttribute("aria-expanded")}`);
      }
      if ((el as HTMLElement).getAttribute("aria-disabled") === "true" ||
          (el as HTMLInputElement).disabled) {
        attrs.push("disabled");
      }
      if ((el as HTMLInputElement).type && role === "textbox") {
        attrs.push(`type="${(el as HTMLInputElement).type}"`);
      }

      const attrStr = attrs.length > 0 ? ` [${attrs.join(", ")}]` : "";
      const nameStr = name ? ` "${name}"` : "";
      lines.push(`${prefix}- ${role ?? el.tagName.toLowerCase()}${nameStr}${attrStr}${marker}`);
      indent++;
    }

    for (const child of el.children) {
      walkAriaTree(child, target, indent, lines, depth + 1);
    }
  }

  // Map HTML elements to implicit ARIA roles
  function getEffectiveRole(el: HTMLElement): string | null {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit;

    const tag = el.tagName.toLowerCase();
    const implicitRoles: Record<string, string> = {
      a: el.hasAttribute("href") ? "link" : "",
      article: "article",
      aside: "complementary",
      button: "button",
      dialog: "dialog",
      footer: "contentinfo",
      form: "form",
      h1: "heading", h2: "heading", h3: "heading",
      h4: "heading", h5: "heading", h6: "heading",
      header: "banner",
      img: "img",
      input: getInputRole(el as HTMLInputElement),
      li: "listitem",
      main: "main",
      nav: "navigation",
      ol: "list",
      option: "option",
      section: el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") ? "region" : "",
      select: "combobox",
      table: "table",
      textarea: "textbox",
      ul: "list",
    };

    return implicitRoles[tag] || null;
  }

  function getInputRole(el: HTMLInputElement): string {
    const type = el.type?.toLowerCase() ?? "text";
    const inputRoles: Record<string, string> = {
      button: "button", checkbox: "checkbox", email: "textbox",
      number: "spinbutton", password: "textbox", radio: "radio",
      range: "slider", search: "searchbox", submit: "button",
      tel: "textbox", text: "textbox", url: "textbox",
    };
    return inputRoles[type] ?? "textbox";
  }

  // Get accessible name for an element
  function getAccessibleName(el: HTMLElement): string {
    // aria-label takes precedence
    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel) return ariaLabel.slice(0, 40);

    // aria-labelledby
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const labelEl = document.getElementById(labelledBy);
      if (labelEl) return (labelEl.textContent ?? "").trim().slice(0, 40);
    }

    // alt for images
    if (el.tagName === "IMG") {
      return (el as HTMLImageElement).alt?.slice(0, 40) ?? "";
    }

    // Direct text content (only for leaf-ish elements)
    const role = getEffectiveRole(el);
    if (role && ["link", "button", "heading", "listitem", "option", "tab"].includes(role)) {
      let text = "";
      for (const node of el.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          text += node.textContent ?? "";
        }
      }
      text = text.trim();
      if (text) return text.slice(0, 40);
      // Fallback to full textContent for simple elements
      const full = (el.textContent ?? "").trim();
      if (full.length <= 40) return full;
      return full.slice(0, 40) + "...";
    }

    return "";
  }

  // Get short text snippet from element's direct text nodes (not children)
  function getTextSnippet(el: HTMLElement): string {
    let text = "";
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent ?? "";
      }
    }
    text = text.trim();
    if (text.length > 20) {
      text = text.slice(0, 20) + "...";
    }
    return text;
  }

  console.log("[design-loop] Element selection script loaded");
})();
