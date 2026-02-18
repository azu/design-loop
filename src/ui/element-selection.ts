import { writeToTerminal } from "./pty-write.ts";

type ElementInfo = {
  selector: string;
  component: {
    name: string;
    source: { fileName: string; lineNumber: number; columnNumber: number } | null;
  } | null;
  styles: Record<string, string>;
  rect: { top: number; left: number; width: number; height: number };
  tagName: string;
  textContent: string | null;
};

let selectionMode = false;
let currentElement: ElementInfo | null = null;

export function initElementSelection(proxyOrigin: string): void {
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

  // Listen for element selection from iframe
  window.addEventListener("message", (event) => {
    if (event.data?.type === "element-selected") {
      const info = event.data.payload as ElementInfo;
      currentElement = info;
      updateContextBar(contextBar, info);
    }
  });

  // Prompt input bar
  const promptInput = document.getElementById("prompt-input") as HTMLTextAreaElement | null;
  const promptSend = document.getElementById("prompt-send");

  if (promptInput && promptSend) {
    function sendPrompt() {
      if (!promptInput) return;
      const text = promptInput.value.trim();
      if (!text) return;

      // Send text first, then Enter separately
      writeToTerminal(text);
      setTimeout(() => {
        writeToTerminal("\r");
      }, 50);
      promptInput.value = "";
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

function updateContextBar(contextBar: HTMLElement, info: ElementInfo): void {
  const parts: string[] = [];

  // Component info
  if (info.component) {
    parts.push(info.component.name);
    if (info.component.source) {
      parts.push(`(${info.component.source.fileName}:${info.component.source.lineNumber})`);
    }
  } else {
    parts.push(`<${info.tagName}>`);
  }

  // Key styles
  const styleEntries = Object.entries(info.styles).slice(0, 6);
  if (styleEntries.length > 0) {
    parts.push("|");
    parts.push(styleEntries.map(([k, v]) => `${k}: ${v}`).join(", "));
  }

  contextBar.textContent = parts.join(" ");
}

export function formatContextForTerminal(instruction: string): string {
  if (!currentElement) return instruction;

  const info = currentElement;
  const lines: string[] = [];
  lines.push("[コンテキスト]");

  if (info.component) {
    const source = info.component.source
      ? ` (${info.component.source.fileName}:${info.component.source.lineNumber})`
      : "";
    lines.push(`選択要素: <${info.tagName}> in ${info.component.name}${source}`);
  } else {
    lines.push(`選択要素: <${info.tagName}>`);
  }

  const styles = Object.entries(info.styles)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");
  if (styles) {
    lines.push(`現在のスタイル: ${styles}`);
  }

  lines.push(`CSSセレクタ: ${info.selector}`);
  lines.push("");
  lines.push("[指示]");
  lines.push(instruction);

  return lines.join("\n");
}

export function sendInstructionToTerminal(instruction: string): void {
  const formatted = formatContextForTerminal(instruction);
  writeToTerminal(formatted + "\n");
}
