import { initTerminal } from "./terminal.ts";
import { initSplitPane } from "./split-pane.ts";
import { initElementSelection } from "./element-selection.ts";
import { initPip } from "./pip.ts";
import { initImageUpload } from "./image-upload.ts";

declare global {
  type DesignLoopConfig = {
    proxyUrl: string;
    ptyWsUrl: string;
    uiBaseUrl: string;
    appDir: string | null;
  };

  // eslint-disable-next-line no-var
  var __DESIGN_LOOP_CONFIG__: DesignLoopConfig | undefined;
}

async function main(): Promise<void> {
  const config = window.__DESIGN_LOOP_CONFIG__;
  if (!config) {
    console.error("[design-loop] No config found");
    return;
  }

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
