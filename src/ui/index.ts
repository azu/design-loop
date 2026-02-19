import { initTerminal } from "./terminal.ts";
import { initSplitPane } from "./split-pane.ts";
import { initElementSelection } from "./element-selection.ts";
import { initDesignMode } from "./design-mode.ts";
import { initPip } from "./pip.ts";
import { initFileUpload } from "./file-upload.ts";

type DesignLoopConfig = {
  proxyUrl: string;
  ptyWsUrl: string;
  uiBaseUrl: string;
  appDir: string | null;
};

async function main(): Promise<void> {
  const res = await fetch("/api/config");
  const config: DesignLoopConfig = await res.json();

  // Set preview iframe src
  const preview = document.getElementById("preview") as HTMLIFrameElement | null;
  if (preview) {
    preview.src = config.proxyUrl;
  }

  // Initialize components
  initSplitPane();
  initElementSelection(config.proxyUrl, config.appDir);
  initDesignMode(config.proxyUrl);
  initPip();
  initFileUpload(config.uiBaseUrl);

  try {
    await initTerminal(config.ptyWsUrl);
  } catch (err) {
    console.error("[design-loop] Terminal init failed:", err);
  }
}

main();
