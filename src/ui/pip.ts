import { refitTerminal, resizeTerminal } from "./terminal.ts";

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
  const rightToolbar = document.getElementById("right-toolbar");

  pipBtn.addEventListener("click", async () => {
    if (typeof documentPictureInPicture === "undefined") return;

    try {
      const pipWindow = await documentPictureInPicture.requestWindow({
        width: 600,
        height: 500,
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

      // Set up PiP body layout
      const pipBody = pipWindow.document.body;
      pipBody.style.cssText = [
        "display:flex",
        "flex-direction:column",
        "height:100vh",
        "margin:0",
        "background:#0a0a0c",
        "color:#ececef",
        "overflow:hidden",
      ].join(";");

      // Move toolbar, terminal container, and prompt bar to PiP window
      const promptBar = document.getElementById("prompt-bar");
      if (rightToolbar) pipBody.appendChild(rightToolbar);
      pipBody.appendChild(terminalContainer);
      if (promptBar) pipBody.appendChild(promptBar);

      // Hide right pane and divider in main window
      rightPane.style.display = "none";
      if (divider) divider.style.display = "none";

      // Fixed terminal size for PiP window (600x500 minus toolbar/prompt)
      setTimeout(() => resizeTerminal(72, 18), 100);

      // When PiP window is closed, move everything back
      pipWindow.addEventListener("pagehide", () => {
        if (rightToolbar) rightPane.insertBefore(rightToolbar, rightPane.firstChild);
        rightPane.appendChild(terminalContainer);
        if (promptBar) rightPane.appendChild(promptBar);
        rightPane.style.display = "";
        if (divider) divider.style.display = "";

        // Re-fit terminal to restored container size
        setTimeout(() => refitTerminal(), 100);
      });
    } catch (err) {
      console.error("[design-loop] PiP error:", err);
    }
  });
}
