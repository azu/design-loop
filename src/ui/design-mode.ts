import { writeToTerminal } from "./pty-write.ts";

type TextEditChange = {
  type: "text-edit";
  selector: string;
  component: string | null;
  sourceFile: string | null;
  before: string;
  after: string;
};

type MoveChange = {
  type: "move";
  selector: string;
  component: string | null;
  oldParentSelector: string;
  oldIndex: number;
  newParentSelector: string;
  newIndex: number;
};

type DesignChange = TextEditChange | MoveChange;

let designModeActive = false;
const changes: DesignChange[] = [];
let currentPageUrl = "";

export function setDesignModePageUrl(url: string): void {
  currentPageUrl = url;
}

export function initDesignMode(proxyOrigin: string): void {
  const toggle = document.getElementById("design-toggle");
  const selectionToggle = document.getElementById("selection-toggle");
  const applyBtn = document.getElementById("design-apply");
  const clearBtn = document.getElementById("design-clear");
  const changeCount = document.getElementById("design-change-count");
  const preview = document.getElementById("preview") as HTMLIFrameElement | null;

  if (!toggle || !preview) return;

  // Toggle design mode
  toggle.addEventListener("click", () => {
    designModeActive = !designModeActive;
    toggle.classList.toggle("active", designModeActive);
    toggle.textContent = designModeActive ? "Design Mode ON" : "Design Mode";

    // Notify iframe
    preview.contentWindow?.postMessage(
      { type: "toggle-design", enabled: designModeActive },
      "*",
    );

    // Turn off selection mode if design mode is on
    if (designModeActive && selectionToggle) {
      selectionToggle.classList.remove("active");
      selectionToggle.textContent = "Select Element";
      preview.contentWindow?.postMessage(
        { type: "toggle-selection", enabled: false },
        "*",
      );
    }

    updateUI();
  });

  // Listen for design mode changes and undo requests from iframe
  window.addEventListener("message", (event) => {
    if (event.data?.type === "design-mode-change") {
      changes.push(event.data.payload as DesignChange);
      updateUI();
    }
    if (event.data?.type === "design-mode-undo-request") {
      undoLastChange();
    }
  });

  // Apply changes
  if (applyBtn) {
    applyBtn.addEventListener("click", () => {
      if (changes.length === 0) return;

      const formatted = formatChangesForClaude(changes, currentPageUrl);
      const promptInput = document.getElementById("prompt-input") as HTMLTextAreaElement | null;
      const userText = promptInput?.value.trim() ?? "";

      // Send as bracketed paste (context)
      writeToTerminal(`\x1b[200~${formatted}\x1b[201~`);

      setTimeout(() => {
        const instruction = userText || "Apply these design changes to the code";
        writeToTerminal(` ${instruction}`);
        setTimeout(() => {
          writeToTerminal("\r");
        }, 200);
      }, 200);

      // Clear
      if (promptInput) {
        promptInput.value = "";
      }
      changes.length = 0;
      updateUI();
    });
  }

  // Undo last change
  const undoBtn = document.getElementById("design-undo");
  if (undoBtn) {
    undoBtn.addEventListener("click", () => {
      undoLastChange();
    });
  }

  // Cmd+Z / Ctrl+Z for undo (only when design mode is active)
  document.addEventListener("keydown", (e) => {
    if (!designModeActive) return;
    if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
      // Don't intercept if focus is in prompt input or terminal
      const active = document.activeElement;
      if (active?.id === "prompt-input" || active?.closest("#terminal-container")) return;
      e.preventDefault();
      undoLastChange();
    }
  });

  function undoLastChange(): void {
    if (changes.length === 0) return;
    const change = changes.pop();
    if (!change) return;

    // Tell iframe to reverse the DOM change
    preview.contentWindow?.postMessage(
      { type: "design-mode-undo", payload: change },
      "*",
    );
    updateUI();
  }

  // Clear changes
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      // Undo all changes in reverse order
      while (changes.length > 0) {
        const change = changes.pop();
        if (change) {
          preview.contentWindow?.postMessage(
            { type: "design-mode-undo", payload: change },
            "*",
          );
        }
      }
      updateUI();
    });
  }

  function updateUI(): void {
    if (changeCount) {
      if (changes.length > 0) {
        changeCount.textContent = String(changes.length);
        changeCount.style.display = "inline-flex";
      } else {
        changeCount.style.display = "none";
      }
    }
    if (applyBtn) {
      applyBtn.style.display = changes.length > 0 ? "inline-flex" : "none";
      applyBtn.textContent = `Apply Changes (${changes.length})`;
    }
    if (clearBtn) {
      clearBtn.style.display = changes.length > 0 ? "inline-flex" : "none";
    }
    if (undoBtn) {
      undoBtn.style.display = changes.length > 0 ? "inline-flex" : "none";
    }
  }
}

// Expose for element-selection.ts to call when turning off design mode from selection toggle
export function deactivateDesignMode(): void {
  const toggle = document.getElementById("design-toggle");
  const preview = document.getElementById("preview") as HTMLIFrameElement | null;
  if (designModeActive) {
    designModeActive = false;
    if (toggle) {
      toggle.classList.remove("active");
      toggle.textContent = "Design Mode";
    }
    preview?.contentWindow?.postMessage(
      { type: "toggle-design", enabled: false },
      "*",
    );
  }
}

// Normalize changes: collapse multiple operations on the same element into one net result.
// - Move: keep first original position + last final position; drop if back to original
// - Text edit: keep first before + last after; drop if text unchanged
function normalizeChanges(changeList: DesignChange[]): DesignChange[] {
  // Process in order, keyed by selector
  const textEdits = new Map<string, TextEditChange>();
  const moves = new Map<string, MoveChange>();
  // Track insertion order
  const order: Array<{ type: "text-edit" | "move"; selector: string }> = [];

  for (const change of changeList) {
    const key = change.selector;

    if (change.type === "text-edit") {
      const existing = textEdits.get(key);
      if (existing) {
        // Keep original `before`, update `after` to latest
        existing.after = change.after;
        // Update component/source info to latest
        existing.component = change.component ?? existing.component;
        existing.sourceFile = change.sourceFile ?? existing.sourceFile;
      } else {
        textEdits.set(key, { ...change });
        order.push({ type: "text-edit", selector: key });
      }
    } else if (change.type === "move") {
      const existing = moves.get(key);
      if (existing) {
        // Keep original old position, update new position to latest
        existing.newParentSelector = change.newParentSelector;
        existing.newIndex = change.newIndex;
        existing.component = change.component ?? existing.component;
      } else {
        moves.set(key, { ...change });
        order.push({ type: "move", selector: key });
      }
    }
  }

  // Build result, filtering out no-ops
  const result: DesignChange[] = [];
  for (const entry of order) {
    if (entry.type === "text-edit") {
      const edit = textEdits.get(entry.selector);
      if (edit && edit.before !== edit.after) {
        result.push(edit);
      }
    } else {
      const move = moves.get(entry.selector);
      if (move) {
        // Drop if element ended up back at its original position
        const sameParent = move.oldParentSelector === move.newParentSelector;
        const sameIndex = move.oldIndex === move.newIndex;
        if (!(sameParent && sameIndex)) {
          result.push(move);
        }
      }
    }
  }

  return result;
}

function formatChangesForClaude(changeList: DesignChange[], pageUrl: string): string {
  const normalized = normalizeChanges(changeList);

  const lines: string[] = [];
  if (pageUrl) {
    lines.push(`[URL: ${pageUrl}]`);
  }
  lines.push("[Design Mode Changes]");

  if (normalized.length === 0) {
    lines.push("(no net changes)");
    return lines.join("\n");
  }

  for (let i = 0; i < normalized.length; i++) {
    const change = normalized[i];
    const num = i + 1;

    if (change.type === "text-edit") {
      lines.push(`${num}. Text edited`);
      const componentPart = change.component
        ? ` (React: ${change.component}${change.sourceFile ? ` - ${change.sourceFile}` : ""})`
        : "";
      lines.push(`   selector: ${change.selector}${componentPart}`);
      lines.push(`   before: "${change.before}"`);
      lines.push(`   after: "${change.after}"`);
    } else if (change.type === "move") {
      lines.push(`${num}. Element reordered`);
      const componentPart = change.component ? ` (React: ${change.component})` : "";
      lines.push(`   selector: ${change.selector}${componentPart}`);
      lines.push(`   moved from: ${change.oldParentSelector}, index ${change.oldIndex}`);
      lines.push(`   moved to: ${change.newParentSelector}, index ${change.newIndex}`);
    }
  }

  return lines.join("\n");
}
