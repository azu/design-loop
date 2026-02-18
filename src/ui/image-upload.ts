import { writeToTerminal } from "./terminal.ts";

export function initImageUpload(apiBaseUrl: string): void {
  const terminalContainer = document.getElementById("terminal-container");
  const dropOverlay = document.getElementById("drop-overlay");

  if (!terminalContainer || !dropOverlay) return;

  let dragCounter = 0;

  terminalContainer.addEventListener("dragenter", (e) => {
    e.preventDefault();
    dragCounter++;
    dropOverlay.classList.add("visible");
  });

  terminalContainer.addEventListener("dragleave", () => {
    dragCounter--;
    if (dragCounter === 0) {
      dropOverlay.classList.remove("visible");
    }
  });

  terminalContainer.addEventListener("dragover", (e) => {
    e.preventDefault();
  });

  terminalContainer.addEventListener("drop", async (e) => {
    e.preventDefault();
    dragCounter = 0;
    dropOverlay.classList.remove("visible");

    const file = e.dataTransfer?.files[0];
    if (!file || !file.type.startsWith("image/")) return;

    try {
      const form = new FormData();
      form.append("image", file);

      const res = await fetch(`${apiBaseUrl}/api/upload-image`, {
        method: "POST",
        body: form,
      });

      if (!res.ok) {
        console.error("[design-loop] Upload failed:", res.statusText);
        return;
      }

      const data = (await res.json()) as { path: string };
      // Write the file path to the terminal so Claude Code can reference it
      writeToTerminal(data.path + " ");
    } catch (err) {
      console.error("[design-loop] Upload error:", err);
    }
  });
}
