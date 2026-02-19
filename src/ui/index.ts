import { initTerminal } from "./terminal.ts";
import { initSplitPane } from "./split-pane.ts";
import { initElementSelection } from "./element-selection.ts";
import { initPip } from "./pip.ts";
import { initImageUpload } from "./image-upload.ts";

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
  initPip();
  initImageUpload(config.uiBaseUrl);

  try {
    await initTerminal(config.ptyWsUrl);
  } catch (err) {
    console.error("[design-loop] Terminal init failed:", err);
  }
}

main();
