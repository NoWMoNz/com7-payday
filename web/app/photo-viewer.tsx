"use client";

import { useEffect, useRef, type RefObject } from "react";

const MAX_ZOOM = 5;
const TAP_ZOOM = 2.5;

/**
 * Full-screen photo. Double-tap zooms in/out at the finger, pinch zooms, drag pans
 * a zoomed photo, and swiping an unzoomed photo up or down closes it. A single tap
 * does nothing, so the photo only goes away via the ✕ button, a swipe, or Escape.
 * Gestures write straight to the DOM so they stay smooth without re-rendering.
 */
export default function PhotoViewer({
  dialogRef,
  src,
  alt,
}: {
  dialogRef: RefObject<HTMLDialogElement | null>;
  src: string;
  alt: string;
}) {
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;

    let s = 1; // scale
    let tx = 0; // translate from the centered position, px
    let ty = 0;
    const pts = new Map<number, { x: number; y: number }>();
    let start = { s: 1, tx: 0, ty: 0, x: 0, y: 0, t: 0, dist: 1, mx: 0, my: 0 };
    let moved = false;
    let swiping = false; // dragging an unzoomed photo to dismiss it
    let lastTap = { t: 0, x: 0, y: 0 };
    let leaving = false;

    const img = () => imgRef.current;
    const fade = (v: number) => d.style.setProperty("--fade", String(v));
    const apply = (animate: boolean) => {
      const el = img();
      if (!el) return;
      el.style.transition = animate ? "transform .25s cubic-bezier(.2,.8,.2,1)" : "none";
      el.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${s})`;
    };
    const clampPan = () => {
      const el = img();
      if (!el) return;
      const mx = Math.max(0, (el.offsetWidth * s - window.innerWidth) / 2);
      const my = Math.max(0, (el.offsetHeight * s - window.innerHeight) / 2);
      tx = Math.min(mx, Math.max(-mx, tx));
      ty = Math.min(my, Math.max(-my, ty));
    };
    /** Zoom to `ns`, keeping the photo point under (px, py) where it is. */
    const zoomAt = (px: number, py: number, ns: number) => {
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      const qx = (px - cx - tx) / s;
      const qy = (py - cy - ty) / s;
      s = ns;
      tx = px - cx - s * qx;
      ty = py - cy - s * qy;
    };
    const reset = () => {
      s = 1;
      tx = 0;
      ty = 0;
    };

    const down = (e: PointerEvent) => {
      if (leaving || (e.target as Element).closest("button")) return;
      d.setPointerCapture(e.pointerId);
      d.style.transition = "none"; // the backdrop follows the finger with no lag
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) {
        start = { ...start, s, tx, ty, x: e.clientX, y: e.clientY, t: performance.now() };
        moved = false;
        swiping = s === 1;
      } else if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        start = { ...start, s, tx, ty, dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
        moved = true;
        swiping = false;
        fade(1);
      }
    };

    const move = (e: PointerEvent) => {
      if (!pts.has(e.pointerId) || leaving) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pts.size >= 2) {
        // pinch: scale around where the fingers started, follow the fingers' midpoint
        const [a, b] = [...pts.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        s = start.s;
        tx = start.tx;
        ty = start.ty;
        zoomAt(start.mx, start.my, Math.min(MAX_ZOOM, Math.max(0.8, (start.s * dist) / start.dist)));
        tx += (a.x + b.x) / 2 - start.mx;
        ty += (a.y + b.y) / 2 - start.my;
        if (s >= 1) clampPan();
        apply(false);
        return;
      }

      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (Math.hypot(dx, dy) > 6) moved = true;
      if (swiping) {
        ty = dy;
        apply(false);
        fade(Math.max(0.15, 1 - Math.abs(dy) / 450));
      } else {
        tx = start.tx + dx;
        ty = start.ty + dy;
        clampPan();
        apply(false);
      }
    };

    const up = (e: PointerEvent) => {
      if (!pts.has(e.pointerId) || leaving) return;
      pts.delete(e.pointerId);

      if (pts.size === 1) {
        // one finger lifted after a pinch: keep panning with the other
        const [p] = [...pts.values()];
        start = { ...start, s, tx, ty, x: p.x, y: p.y };
        swiping = false;
        return;
      }
      if (pts.size > 0) return;

      if (swiping) {
        const speed = Math.abs(ty) / Math.max(1, performance.now() - start.t);
        if (Math.abs(ty) > 120 || (Math.abs(ty) > 40 && speed > 0.6)) {
          // fling it off screen, then close
          leaving = true;
          const el = img();
          if (el) {
            el.style.transition = "transform .2s ease-in";
            el.style.transform = `translate3d(0, ${Math.sign(ty) * window.innerHeight}px, 0)`;
          }
          d.style.transition = "--fade .2s";
          fade(0);
          setTimeout(() => d.close(), 200);
          return;
        }
        ty = 0;
        d.style.transition = "--fade .25s";
        fade(1);
        apply(true);
      } else if (s < 1.02) {
        reset(); // pinched below full size: settle back
        apply(true);
      }

      if (!moved) {
        const now = performance.now();
        const near = Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40;
        if (now - lastTap.t < 320 && near) {
          if (s > 1) reset();
          else {
            zoomAt(e.clientX, e.clientY, TAP_ZOOM);
            clampPan();
          }
          apply(true);
          lastTap = { t: 0, x: 0, y: 0 };
        } else {
          lastTap = { t: now, x: e.clientX, y: e.clientY };
        }
      }
    };

    // desktop: wheel / trackpad zoom at the cursor
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const ns = Math.min(MAX_ZOOM, Math.max(1, s * Math.exp(-e.deltaY / 300)));
      zoomAt(e.clientX, e.clientY, ns);
      if (s === 1) reset();
      clampPan();
      apply(false);
    };

    const onClose = () => {
      pts.clear();
      leaving = false;
      reset();
      lastTap = { t: 0, x: 0, y: 0 };
      d.style.transition = "";
      fade(1);
      const el = img();
      if (el) {
        el.style.transition = "none";
        el.style.transform = "";
      }
    };

    d.addEventListener("pointerdown", down);
    d.addEventListener("pointermove", move);
    d.addEventListener("pointerup", up);
    d.addEventListener("pointercancel", up);
    d.addEventListener("wheel", wheel, { passive: false });
    d.addEventListener("close", onClose);
    return () => {
      d.removeEventListener("pointerdown", down);
      d.removeEventListener("pointermove", move);
      d.removeEventListener("pointerup", up);
      d.removeEventListener("pointercancel", up);
      d.removeEventListener("wheel", wheel);
      d.removeEventListener("close", onClose);
    };
  }, [dialogRef]);

  return (
    <dialog ref={dialogRef} className="lightbox" aria-label="รูปของขวัญ">
      {src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img ref={imgRef} src={src} alt={alt} draggable={false} />
      )}
      <button className="close lightbox-close" type="button" aria-label="ปิดรูป" onClick={() => dialogRef.current?.close()}>
        ✕
      </button>
      <p className="lightbox-hint" aria-hidden="true">
        แตะสองครั้งเพื่อซูม · ปัดขึ้นหรือลงเพื่อปิด
      </p>
    </dialog>
  );
}
