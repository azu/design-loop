declare global {
  // Document Picture-in-Picture API types
  // eslint-disable-next-line no-var
  var documentPictureInPicture: {
    requestWindow(options: {
      width: number;
      height: number;
    }): Promise<Window>;
  } | undefined;
}

export function initPip(): void {
  const pipBtn = document.getElementById("pip-btn");
  const terminalContainer = document.getElementById("terminal-container");
  const rightPane = document.getElementById("right-pane");

  if (!pipBtn || !terminalContainer || !rightPane) return;

  // Only show PiP button if API is available
  if (typeof documentPictureInPicture === "undefined") return;

  pipBtn.style.display = "inline-block";

  const divider = document.getElementById("divider");

  pipBtn.addEventListener("click", async () => {
    if (typeof documentPictureInPicture === "undefined") return;

    try {
      const pipWindow = await documentPictureInPicture.requestWindow({
        width: 480,
        height: 440,
      });

      // Copy stylesheets
      for (const sheet of document.styleSheets) {
        try {
          const style = document.createElement("style");
          style.textContent = [...sheet.cssRules]
            .map((r) => r.cssText)
            .join("");
          pipWindow.document.head.appendChild(style);
        } catch {
          // Skip cross-origin stylesheets
        }
      }

      const pipDoc = pipWindow.document;

      // Get prompt-bar BEFORE moving terminal (both are in right-pane)
      const promptBar = document.getElementById("prompt-bar");

      // Create a wrapper with explicit layout to isolate from ghostty-web canvas sizing
      const wrapper = pipDoc.createElement("div");
      wrapper.id = "pip-wrapper";
      wrapper.style.cssText = [
        "position: absolute",
        "inset: 0",
        "display: grid",
        "grid-template-rows: 1fr auto",
        "overflow: hidden",
        "background: #0a0a0c",
      ].join(";");

      // Move elements into wrapper
      wrapper.appendChild(terminalContainer);
      if (promptBar) {
        wrapper.appendChild(promptBar);
      }
      pipDoc.body.style.cssText = "margin:0;padding:0;background:#0a0a0c;";
      pipDoc.body.appendChild(wrapper);

      // Hide right pane and divider
      rightPane.style.display = "none";
      if (divider) divider.style.display = "none";

      // When PiP window is closed, move everything back
      pipWindow.addEventListener("pagehide", () => {
        rightPane.appendChild(terminalContainer);
        if (promptBar) {
          rightPane.appendChild(promptBar);
        }
        rightPane.style.display = "";
        if (divider) divider.style.display = "";
        window.dispatchEvent(new Event("resize"));
      });

      // Trigger resize for terminal to recalculate
      window.dispatchEvent(new Event("resize"));
    } catch (err) {
      console.error("[design-loop] PiP error:", err);
    }
  });
}
