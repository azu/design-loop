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
        height: 360,
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

      // Move terminal container to PiP window
      pipWindow.document.body.appendChild(terminalContainer);

      // Hide right pane and divider
      rightPane.style.display = "none";
      if (divider) divider.style.display = "none";

      // When PiP window is closed, move terminal back
      pipWindow.addEventListener("pagehide", () => {
        rightPane.appendChild(terminalContainer);
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
