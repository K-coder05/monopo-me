import { useLayoutEffect, useRef, useState, type ReactNode, type TouchEvent } from 'react';

const MIN_ZOOM = 1;
const MAX_ZOOM = 3;
const clamp = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

const distance = (e: TouchEvent) => {
  const [a, b] = [e.touches[0]!, e.touches[1]!];
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
};

/**
 * A square viewport that zooms its content with a pinch or the +/− buttons and pans by scrolling
 * (one finger on a phone). Zoom keeps the point under the fingers, or the centre, in place.
 */
export function PanZoom({ children }: { children: ReactNode }) {
  const viewport = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  // The zoom as of the last change, which a burst of pinch moves may make before React re-renders.
  const live = useRef(1);
  // The point (in viewport pixels) to hold still across the next zoom change.
  const anchor = useRef<{ x: number; y: number; from: number } | null>(null);
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);

  const zoomTo = (next: number, x?: number, y?: number) => {
    const el = viewport.current;
    if (!el) return;
    // Several changes before one re-render hold the first one's anchor, measured from the rendered zoom.
    anchor.current ??= { x: x ?? el.clientWidth / 2, y: y ?? el.clientHeight / 2, from: live.current };
    live.current = clamp(next);
    setZoom(live.current);
  };

  useLayoutEffect(() => {
    const el = viewport.current;
    const a = anchor.current;
    if (!el || !a) return;
    const ratio = zoom / a.from;
    el.scrollLeft = (el.scrollLeft + a.x) * ratio - a.x;
    el.scrollTop = (el.scrollTop + a.y) * ratio - a.y;
    anchor.current = null;
  }, [zoom]);

  const onTouchStart = (e: TouchEvent) => {
    if (e.touches.length === 2) pinch.current = { distance: distance(e), zoom: live.current };
  };
  const onTouchMove = (e: TouchEvent) => {
    const start = pinch.current;
    const el = viewport.current;
    if (!start || !el || e.touches.length !== 2) return;
    const box = el.getBoundingClientRect();
    const [a, b] = [e.touches[0]!, e.touches[1]!];
    zoomTo(start.zoom * (distance(e) / start.distance), (a.clientX + b.clientX) / 2 - box.left, (a.clientY + b.clientY) / 2 - box.top);
  };
  const onTouchEnd = (e: TouchEvent) => {
    if (e.touches.length < 2) pinch.current = null;
  };

  return (
    <div className="pan-zoom">
      <div
        ref={viewport}
        className="board-viewport"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        <div className="board-zoom" style={{ width: `${zoom * 100}%` }}>
          {children}
        </div>
      </div>
      <div className="zoom-controls">
        <button type="button" className="small secondary" aria-label="Zoom out" disabled={zoom <= MIN_ZOOM} onClick={() => zoomTo(zoom - 0.5)}>
          −
        </button>
        <button type="button" className="small secondary" aria-label="Zoom in" disabled={zoom >= MAX_ZOOM} onClick={() => zoomTo(zoom + 0.5)}>
          +
        </button>
      </div>
    </div>
  );
}
