import { writeToTerminal } from "./pty-write.ts";

export function initFileUpload(apiBaseUrl: string): void {
  const terminalContainer = document.getElementById("terminal-container");
  const dropOverlay = document.getElementById("drop-overlay");

  if (!terminalContainer || !dropOverlay) return;

  // -- Drag and drop --
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

    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    await uploadFiles(apiBaseUrl, Array.from(files));
  });

  // -- Upload button --
  const uploadBtn = document.getElementById("upload-btn");
  const fileInput = document.getElementById("file-input") as HTMLInputElement | null;

  if (uploadBtn && fileInput) {
    uploadBtn.addEventListener("click", () => {
      fileInput.click();
    });

    fileInput.addEventListener("change", async () => {
      const files = fileInput.files;
      if (!files || files.length === 0) return;
      await uploadFiles(apiBaseUrl, Array.from(files));
      fileInput.value = "";
    });
  }

  // -- Clipboard paste (Cmd+V) --
  document.addEventListener("paste", async (e) => {
    const clipboardData = e.clipboardData;
    if (!clipboardData) return;

    // Only intercept if clipboard contains files.
    // If it's plain text, let the terminal handle it normally.
    const files = extractFilesFromClipboard(clipboardData);
    if (files.length === 0) return;

    e.preventDefault();
    await uploadFiles(apiBaseUrl, files);
  });
}

function extractFilesFromClipboard(clipboardData: DataTransfer): File[] {
  const files: File[] = [];

  for (let i = 0; i < clipboardData.items.length; i++) {
    const item = clipboardData.items[i];
    if (item.kind === "file") {
      const file = item.getAsFile();
      if (file) {
        files.push(file);
      }
    }
  }

  return files;
}

async function uploadFiles(apiBaseUrl: string, files: File[]): Promise<void> {
  if (files.length === 0) return;

  try {
    const form = new FormData();
    for (const file of files) {
      form.append("file", file);
    }

    const res = await fetch(`${apiBaseUrl}/api/upload-file`, {
      method: "POST",
      body: form,
    });

    if (!res.ok) {
      console.error("[design-loop] Upload failed:", res.statusText);
      return;
    }

    const data = (await res.json()) as { paths: string[] };
    const pathStr = data.paths.join(" ");
    writeToTerminal(pathStr + " ");
  } catch (err) {
    console.error("[design-loop] Upload error:", err);
  }
}
