import { writeToTerminal } from "./pty-write.ts";

type ElementInfo = {
  selector: string;
  component: {
    name: string;
    props: Record<string, string>;
    source: { fileName: string; lineNumber: number; columnNumber: number } | null;
    hierarchy: string[];
  } | null;
  styles: Record<string, string>;
  rect: { top: number; left: number; width: number; height: number };
  tagName: string;
  textContent: string | null;
  ariaSnapshot: string;
};

let selectionMode = false;
const selectedElements: ElementInfo[] = [];
let currentPageUrl = "";

export function initElementSelection(proxyOrigin: string, appDir: string | null): void {
  const toggle = document.getElementById("selection-toggle");
  const contextBar = document.getElementById("context-bar");
  const preview = document.getElementById("preview") as HTMLIFrameElement | null;

  if (!toggle || !contextBar || !preview) return;

  // Toggle selection mode
  toggle.addEventListener("click", () => {
    selectionMode = !selectionMode;
    toggle.classList.toggle("active", selectionMode);
    toggle.textContent = selectionMode ? "Select Mode ON" : "Select Element";

    // Notify iframe
    preview.contentWindow?.postMessage(
      { type: "toggle-selection", enabled: selectionMode },
      "*",
    );
  });

  // Esc key toggles selection mode
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      selectionMode = !selectionMode;
      toggle.classList.toggle("active", selectionMode);
      toggle.textContent = selectionMode ? "Select Mode ON" : "Select Element";

      preview.contentWindow?.postMessage(
        { type: "toggle-selection", enabled: selectionMode },
        "*",
      );
    }
  });

  // Navigation buttons
  const navBack = document.getElementById("nav-back") as HTMLButtonElement | null;
  const navForward = document.getElementById("nav-forward") as HTMLButtonElement | null;
  const navReload = document.getElementById("nav-reload") as HTMLButtonElement | null;
  const navUrl = document.getElementById("nav-url");

  if (navBack) {
    navBack.addEventListener("click", () => {
      preview.contentWindow?.history.back();
    });
  }
  if (navForward) {
    navForward.addEventListener("click", () => {
      preview.contentWindow?.history.forward();
    });
  }
  if (navReload) {
    navReload.addEventListener("click", () => {
      preview.contentWindow?.location.reload();
    });
  }

  const promptInput = document.getElementById("prompt-input") as HTMLTextAreaElement | null;
  const selectedElementEl = document.getElementById("selected-element");
  const pageUrlEl = document.getElementById("page-url");

  // Listen for messages from iframe
  window.addEventListener("message", (event) => {
    if (event.data?.type === "element-selected") {
      const info = event.data.payload as ElementInfo;
      selectedElements.push(info);
      updateContextBar(contextBar, info);
      renderSelectedBadges(selectedElementEl);

      if (promptInput) {
        promptInput.focus();
      }
    }

    if (event.data?.type === "page-url") {
      currentPageUrl = event.data.pathname ?? "";
      if (pageUrlEl) {
        pageUrlEl.textContent = currentPageUrl || "";
        pageUrlEl.style.display = currentPageUrl ? "inline-block" : "none";
      }
      // Update URL bar
      if (navUrl) {
        navUrl.textContent = currentPageUrl || "/";
      }
      // Enable/disable back/forward based on iframe history
      // (can't query history length reliably, so enable after first navigation)
      if (navBack) {
        navBack.disabled = false;
      }
    }
  });

  // Prompt input bar
  const promptSend = document.getElementById("prompt-send");

  if (promptInput && promptSend) {
    function sendPrompt() {
      if (!promptInput) return;
      const text = promptInput.value.trim();
      if (!text) return;

      // Build context (URL, elements) as attachment
      const contextParts: string[] = [];

      if (currentPageUrl) {
        contextParts.push(`[URL: ${currentPageUrl}]`);
      }

      if (selectedElements.length > 0) {
        const labels = selectedElements.map((el) => formatElementLabel(el));
        for (const label of labels) {
          contextParts.push(`[${label}]`);
        }
      }

      // Send context as bracketed paste (collapsed by Claude Code TUI),
      // then space + user text as normal input (visible), then Enter.
      // 100ms delays so Claude Code treats them as separate inputs.
      if (contextParts.length > 0) {
        const attachment = contextParts.join("\n");
        writeToTerminal(`\x1b[200~${attachment}\x1b[201~`);

      }
      setTimeout(() => {
        if (contextParts.length > 0) {
          writeToTerminal(" ");
        }
        writeToTerminal(text);
        setTimeout(() => {
          writeToTerminal("\r");
        }, 200);
      }, 200);

      promptInput.value = "";

      // Clear selections after send
      selectedElements.length = 0;
      renderSelectedBadges(selectedElementEl);
    }

    promptInput.addEventListener("keydown", (e) => {
      if (e.isComposing) return;
      // Cmd+Enter (Mac) or Ctrl+Enter (Windows/Linux) to send
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        sendPrompt();
      }
    });

    promptSend.addEventListener("click", sendPrompt);
  }
}

// Format the full label sent to Claude (should be as informative as possible)
function formatElementLabel(info: ElementInfo): string {
  const lines: string[] = [];

  // Component hierarchy + name
  if (info.component) {
    const hierarchy = info.component.hierarchy.length > 0
      ? [...info.component.hierarchy].reverse().join(" > ") + " > "
      : "";
    lines.push(`${hierarchy}${info.component.name} <${info.tagName}>`);

    // Source file
    if (info.component.source) {
      lines.push(`  file: ${info.component.source.fileName}:${info.component.source.lineNumber}`);
    }

    // Props (all of them, including className)
    const propEntries = Object.entries(info.component.props);
    if (propEntries.length > 0) {
      for (const [k, v] of propEntries) {
        lines.push(`  ${k}: ${v}`);
      }
    }
  } else {
    lines.push(`<${info.tagName}> ${info.selector}`);
  }

  // Text content
  if (info.textContent) {
    lines.push(`  text: "${info.textContent}"`);
  }

  // Aria snapshot (structural context)
  if (info.ariaSnapshot) {
    lines.push(`  ---`);
    lines.push(info.ariaSnapshot);
  }

  return lines.join("\n");
}

function renderSelectedBadges(container: HTMLElement | null): void {
  if (!container) return;

  container.innerHTML = "";

  if (selectedElements.length === 0) {
    container.style.display = "none";
    return;
  }

  container.style.display = "flex";

  for (let i = 0; i < selectedElements.length; i++) {
    const info = selectedElements[i];
    const textPart = info.textContent ? ` "${info.textContent.length > 15 ? info.textContent.slice(0, 15) + "..." : info.textContent}"` : "";
    const label = info.component
      ? `${info.component.name}${textPart} <${info.tagName}>`
      : `<${info.tagName}>${textPart}`;

    const badge = document.createElement("span");
    badge.className = "tag";
    badge.textContent = label;

    const dismiss = document.createElement("span");
    dismiss.className = "dismiss";
    dismiss.textContent = "\u00d7";
    const index = i;
    dismiss.addEventListener("click", () => {
      selectedElements.splice(index, 1);
      renderSelectedBadges(container);
    });
    badge.appendChild(dismiss);

    container.appendChild(badge);
  }

  // Clear all button
  if (selectedElements.length > 1) {
    const clearAll = document.createElement("span");
    clearAll.className = "dismiss";
    clearAll.textContent = "Clear all";
    clearAll.style.cursor = "pointer";
    clearAll.style.fontSize = "11px";
    clearAll.style.marginLeft = "4px";
    clearAll.addEventListener("click", () => {
      selectedElements.length = 0;
      renderSelectedBadges(container);
    });
    container.appendChild(clearAll);
  }
}

function updateContextBar(contextBar: HTMLElement, info: ElementInfo): void {
  const parts: string[] = [];

  if (info.component) {
    parts.push(info.component.name);
    if (info.component.source) {
      parts.push(`(${info.component.source.fileName}:${info.component.source.lineNumber})`);
    }
  } else {
    parts.push(`<${info.tagName}>`);
  }

  const styleEntries = Object.entries(info.styles).slice(0, 6);
  if (styleEntries.length > 0) {
    parts.push("|");
    parts.push(styleEntries.map(([k, v]) => `${k}: ${v}`).join(", "));
  }

  contextBar.textContent = parts.join(" ");
}
