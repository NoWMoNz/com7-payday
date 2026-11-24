/**
 * Drag a bottom sheet (a <dialog>) down from anywhere on it to close it.
 * If the content is taller than the screen it scrolls instead (the dialog gets a "scrolls" class), and only
 * the handle and title ([data-drag]) drag. A drag that starts on a button closes the sheet without pressing it.
 * Returns the function that removes the listeners.
 */
export function attachSheetDrag(d: HTMLDialogElement, isBusy: () => boolean): () => void {
  let startX = 0;
  let startY = 0;
  let dy = 0;
  let t0 = 0;
  let tracking = false; // a finger is down and might become a drag
  let dragging = false; // it has become a downward drag
  let moved = false;

  const down = (e: PointerEvent) => {
    moved = false; // every new touch starts clean
    if (isBusy()) return;
    const t = e.target as Element;
    const scrolls = d.classList.contains("scrolls");
    if (scrolls && (!t.closest("[data-drag]") || t.closest("button"))) return; // let the content scroll
    tracking = true;
    dragging = false;
    startX = e.clientX;
    startY = e.clientY;
    dy = 0;
    t0 = performance.now();
    // capture on the touched element itself so a tap still reaches its own button
    t.setPointerCapture?.(e.pointerId);
  };
  // a drag must not also count as a tap on whatever is under the finger
  const swallowClick = (e: MouseEvent) => {
    if (!moved) return;
    moved = false;
    e.stopPropagation();
    e.preventDefault();
  };
  const move = (e: PointerEvent) => {
    if (!tracking) return;
    const dx = e.clientX - startX;
    const rawY = e.clientY - startY;
    if (!dragging) {
      if (Math.hypot(dx, rawY) < 8) return; // still a tap
      moved = true;
      if (rawY <= 0 || rawY < Math.abs(dx)) {
        tracking = false; // sideways or upward: not ours
        return;
      }
      dragging = true;
      d.style.transition = "none";
      d.style.userSelect = "none";
    }
    dy = Math.max(0, rawY);
    d.style.transform = `translateY(${dy}px)`;
    d.style.setProperty("--drag", String(Math.max(0, 1 - dy / 420))); // the dim backdrop fades as it goes
  };
  const up = () => {
    if (!tracking) return;
    tracking = false;
    if (!dragging) return;
    dragging = false;
    d.style.userSelect = "";
    const speed = dy / Math.max(1, performance.now() - t0);
    if (dy > 110 || (dy > 30 && speed > 0.6)) {
      d.style.transition = "transform .22s cubic-bezier(.4,0,1,1)";
      d.style.transform = "translateY(100%)";
      d.style.setProperty("--drag", "0");
      setTimeout(() => {
        d.close();
        d.style.transition = "";
        d.style.transform = "";
        d.style.removeProperty("--drag");
      }, 210);
    } else {
      d.style.transition = "transform .22s cubic-bezier(.2,.8,.2,1)";
      d.style.transform = "";
      d.style.removeProperty("--drag");
    }
  };

  d.addEventListener("pointerdown", down);
  d.addEventListener("pointermove", move);
  d.addEventListener("pointerup", up);
  d.addEventListener("pointercancel", up);
  d.addEventListener("click", swallowClick, true);
  return () => {
    d.removeEventListener("click", swallowClick, true);
    d.removeEventListener("pointerdown", down);
    d.removeEventListener("pointermove", move);
    d.removeEventListener("pointerup", up);
    d.removeEventListener("pointercancel", up);
  };
}

/** Mark a sheet taller than the screen, so it scrolls instead of being dragged from its middle. */
export function markScrollable(d: HTMLDialogElement | null) {
  d?.classList.toggle("scrolls", d.scrollHeight > d.clientHeight + 1);
}
