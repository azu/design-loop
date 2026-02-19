const STORAGE_KEY = "design-loop-split-ratio";
const MIN_WIDTH = 200;

export function initSplitPane(): void {
  const leftPane = document.getElementById("left-pane");
  const rightPane = document.getElementById("right-pane");
  const divider = document.getElementById("divider");

  if (!leftPane || !rightPane || !divider) return;

  // Transparent overlay to prevent iframe from stealing mouse events during drag
  const dragOverlay = document.createElement("div");
  dragOverlay.style.cssText =
    "position:fixed;inset:0;z-index:9999;cursor:col-resize;display:none;";
  document.body.appendChild(dragOverlay);

  // Restore saved ratio
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    const ratio = parseFloat(saved);
    if (ratio > 0 && ratio < 1) {
      leftPane.style.flex = `1 1 ${ratio * 100}%`;
      rightPane.style.flex = `1 1 ${(1 - ratio) * 100}%`;
    }
  }

  let isDragging = false;

  function stopDrag() {
    if (!isDragging) return;
    isDragging = false;
    dragOverlay.style.display = "none";
    divider?.classList.remove("dragging");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";

    // Save ratio
    const appWidth = document.getElementById("app")?.offsetWidth ?? window.innerWidth;
    const leftWidth = leftPane?.offsetWidth ?? 0;
    const ratio = leftWidth / appWidth;
    localStorage.setItem(STORAGE_KEY, ratio.toString());

    // Trigger resize event for terminal to recalculate
    window.dispatchEvent(new Event("resize"));
  }

  divider.addEventListener("mousedown", (e) => {
    e.preventDefault();
    isDragging = true;
    dragOverlay.style.display = "block";
    divider.classList.add("dragging");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  });

  document.addEventListener("mousemove", (e) => {
    if (!isDragging) return;

    const appWidth = document.getElementById("app")?.offsetWidth ?? window.innerWidth;
    const dividerWidth = divider.offsetWidth;
    const x = e.clientX;

    const leftWidth = Math.max(MIN_WIDTH, Math.min(x, appWidth - MIN_WIDTH - dividerWidth));
    const rightWidth = appWidth - leftWidth - dividerWidth;

    leftPane.style.flex = `0 0 ${leftWidth}px`;
    rightPane.style.flex = `0 0 ${rightWidth}px`;
  });

  document.addEventListener("mouseup", stopDrag);

  // Also stop if mouse leaves the window
  document.addEventListener("mouseleave", stopDrag);
}
