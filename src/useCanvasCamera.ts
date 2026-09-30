// Camera for the topology canvas: zoom and pan over fixed-size content.
// Conventions follow Figma/Miro so the canvas feels familiar:
//   wheel (mouse)        zoom at the cursor, smoothly
//   wheel (trackpad)     pan; ctrl/cmd + wheel or pinch zooms
//   drag empty canvas    pan with momentum; click empty canvas deselects
//   middle mouse / space+drag   pan from anywhere, even over a node
//   double-click empty   zoom in (shift: out)
//   two fingers          pinch zoom + pan
//   + - 0 / arrows       keyboard zoom, fit, pan
// Nodes are never moved; only the camera is.
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";

export type Cam = { x: number; y: number; z: number };
type Rect = { x: number; y: number; w: number; h: number };

type Options = {
  contentW: number;
  contentH: number;
  /** Floating UI that covers part of the viewport, so "fit" centers in what is visible. */
  insetTop?: number;
  insetRight?: number;
  insetBottom?: number;
  minZoom?: number;
  maxZoom?: number;
  /** Default view never zooms below this; "fit all" may. */
  readableMin?: number;
  /** Pointer-downs on these keep their own behavior (nodes start a link drag). */
  ignoreSelector?: string;
  onEmptyClick?: () => void;
};

const KEEP_VISIBLE = 140; // px of content that must stay on screen

export function useCanvasCamera({
  contentW,
  contentH,
  insetTop = 0,
  insetRight = 0,
  insetBottom = 56,
  minZoom = 0.35,
  maxZoom = 2.2,
  readableMin = 0.6,
  ignoreSelector = ".topo-node, [data-topo-overlay], path[role=button]",
  onEmptyClick,
}: Options) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [cam, setCamState] = useState<Cam>({ x: 0, y: 0, z: 1 });
  const camRef = useRef<Cam>(cam);
  const targetRef = useRef<Cam>(cam);
  const easeRef = useRef(0.25);
  const glideRaf = useRef<number | null>(null);
  const coastRaf = useRef<number | null>(null);
  const touched = useRef(false);
  const spaceRef = useRef(false);
  const [vp, setVp] = useState({ w: 0, h: 0 });
  const [panning, setPanning] = useState(false);
  const emptyClick = useRef(onEmptyClick);
  emptyClick.current = onEmptyClick;

  type Drag = { id: number; px: number; py: number; ox: number; oy: number; moved: boolean; empty: boolean; samples: { t: number; x: number; y: number }[] };
  const drag = useRef<Drag | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; z: number; cx: number; cy: number; ox: number; oy: number } | null>(null);

  const clampZoom = useCallback((z: number) => Math.min(maxZoom, Math.max(minZoom, z)), [maxZoom, minZoom]);

  /** Keep some content on screen so the graph can never be lost. */
  const clampCam = useCallback((c: Cam): Cam => {
    const el = viewportRef.current;
    if (!el || el.clientWidth === 0) return c;
    const cw = contentW * c.z;
    const ch = contentH * c.z;
    return {
      z: c.z,
      x: Math.min(el.clientWidth - KEEP_VISIBLE, Math.max(KEEP_VISIBLE - cw, c.x)),
      y: Math.min(el.clientHeight - KEEP_VISIBLE, Math.max(KEEP_VISIBLE - ch, c.y)),
    };
  }, [contentW, contentH]);

  const commit = useCallback((c: Cam) => {
    camRef.current = c;
    setCamState(c);
  }, []);

  const stopMotion = useCallback(() => {
    if (glideRaf.current != null) cancelAnimationFrame(glideRaf.current);
    if (coastRaf.current != null) cancelAnimationFrame(coastRaf.current);
    glideRaf.current = null;
    coastRaf.current = null;
  }, []);

  /** Jump without easing (dragging, trackpad pan, initial fit). */
  const place = useCallback((c: Cam) => {
    const next = clampCam(c);
    targetRef.current = next;
    commit(next);
  }, [clampCam, commit]);

  /** Ease toward a target; repeated calls just move the target, so a burst of
   *  wheel events accumulates into one smooth zoom. */
  const glide = useCallback((target: Cam, ease = 0.25) => {
    if (coastRaf.current != null) { cancelAnimationFrame(coastRaf.current); coastRaf.current = null; }
    targetRef.current = clampCam(target);
    easeRef.current = ease;
    if (glideRaf.current != null) return;
    const tick = () => {
      const c = camRef.current;
      const t = targetRef.current;
      const e = easeRef.current;
      const next = { x: c.x + (t.x - c.x) * e, y: c.y + (t.y - c.y) * e, z: c.z + (t.z - c.z) * e };
      const done = Math.abs(t.x - next.x) < 0.3 && Math.abs(t.y - next.y) < 0.3 && Math.abs(t.z - next.z) < 0.0008;
      commit(done ? t : next);
      glideRaf.current = done ? null : requestAnimationFrame(tick);
    };
    glideRaf.current = requestAnimationFrame(tick);
  }, [clampCam, commit]);

  const zoomAtTarget = useCallback((factor: number, px: number, py: number, ease = 0.28) => {
    touched.current = true;
    const base = targetRef.current;
    const z = clampZoom(base.z * factor);
    const k = z / base.z;
    glide({ z, x: px - (px - base.x) * k, y: py - (py - base.y) * k }, ease);
  }, [clampZoom, glide]);

  const zoomBy = useCallback((factor: number) => {
    const el = viewportRef.current;
    if (!el) return;
    zoomAtTarget(factor, (el.clientWidth - insetRight) / 2, insetTop + (el.clientHeight - insetTop - insetBottom) / 2, 0.24);
  }, [zoomAtTarget, insetRight, insetTop, insetBottom]);

  /** Readable default (width first, never under `readableMin`, centered on the
   *  midline where agents and projects sit); `all` fits the whole graph. */
  const fit = useCallback((all = false, smooth = false) => {
    const el = viewportRef.current;
    if (!el || el.clientWidth === 0) return;
    const pad = 48;
    const availW = el.clientWidth - insetRight;
    const availH = el.clientHeight - insetTop - insetBottom;
    const zw = (availW - pad * 2) / contentW;
    const zh = (availH - pad * 2) / contentH;
    const whole = Math.min(zw, zh);
    const z = all || whole >= readableMin ? Math.min(1.25, Math.max(minZoom, whole)) : Math.min(1, Math.max(readableMin, zw));
    const target = { z, x: (availW - contentW * z) / 2, y: insetTop + (availH - contentH * z) / 2 };
    if (smooth) glide(target, 0.2);
    else { stopMotion(); place(target); }
  }, [contentW, contentH, insetTop, insetRight, insetBottom, minZoom, readableMin, glide, place, stopMotion]);

  const resetView = useCallback(() => { touched.current = false; fit(false, true); }, [fit]);
  const fitAll = useCallback(() => { touched.current = true; fit(true, true); }, [fit]);

  const flyTo = useCallback((r: Rect, maxZ = 1.3) => {
    const el = viewportRef.current;
    if (!el) return;
    touched.current = true;
    const availW = el.clientWidth - insetRight;
    const availH = el.clientHeight - insetTop - insetBottom;
    const z = Math.min(maxZ, Math.max(minZoom, Math.min((availW - 96) / r.w, (availH - 96) / r.h)));
    glide({ z, x: (availW - r.w * z) / 2 - r.x * z, y: insetTop + (availH - r.h * z) / 2 - r.y * z }, 0.16);
  }, [insetTop, insetRight, insetBottom, minZoom, glide]);

  /** Center the view on a content point (minimap). */
  const centerOn = useCallback((cx: number, cy: number) => {
    const el = viewportRef.current;
    if (!el) return;
    touched.current = true;
    stopMotion();
    const z = camRef.current.z;
    place({ z, x: el.clientWidth / 2 - cx * z, y: el.clientHeight / 2 - cy * z });
  }, [place, stopMotion]);

  // Initial fit, refit on resize until the user moves the camera, track size.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    setVp({ w: el.clientWidth, h: el.clientHeight });
    if (!touched.current) fit();
    const observer = new ResizeObserver(() => {
      setVp({ w: el.clientWidth, h: el.clientHeight });
      if (!touched.current) fit();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [fit]);

  useEffect(() => () => stopMotion(), [stopMotion]);

  // Wheel: native listener so preventDefault works (React's is passive).
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    function onWheel(event: WheelEvent) {
      if ((event.target as HTMLElement).closest?.("[data-topo-overlay]")) return;
      event.preventDefault();
      const node = el as HTMLDivElement;
      const rect = node.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? node.clientHeight : 1;
      const dx = event.deltaX * unit;
      const dy = event.deltaY * unit;
      const pinchZoom = event.ctrlKey || event.metaKey; // browsers send pinch as ctrl+wheel
      const mouseWheel = !pinchZoom && (event.deltaMode !== 0 || (dx === 0 && Math.abs(dy) >= 40 && Number.isInteger(event.deltaY)));
      if (pinchZoom) {
        zoomAtTarget(Math.exp(-dy * 0.01), px, py, 0.4);
      } else if (mouseWheel) {
        zoomAtTarget(Math.exp(-Math.sign(dy) * Math.min(Math.abs(dy), 120) * 0.002), px, py);
      } else {
        // Trackpad two-finger scroll pans.
        touched.current = true;
        stopMotion();
        place({ ...camRef.current, x: camRef.current.x - dx, y: camRef.current.y - dy });
      }
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAtTarget, place, stopMotion]);

  const isIgnored = (target: EventTarget | null) => !!ignoreSelector && !!(target as HTMLElement | null)?.closest?.(ignoreSelector);

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    const el = event.currentTarget;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const rect = el.getBoundingClientRect();
      stopMotion();
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: camRef.current.z, cx: (a.x + b.x) / 2 - rect.left, cy: (a.y + b.y) / 2 - rect.top, ox: camRef.current.x, oy: camRef.current.y };
      drag.current = null;
      setPanning(false);
      return;
    }
    const onNode = isIgnored(event.target);
    const wantsPan = event.button === 1 || event.button === 2 || (event.button === 0 && (!onNode || spaceRef.current));
    if (!wantsPan) return;
    if (event.button === 1 || event.button === 2) event.preventDefault();
    stopMotion();
    try { el.setPointerCapture(event.pointerId); } catch { /* synthetic pointers cannot be captured */ }
    drag.current = { id: event.pointerId, px: event.clientX, py: event.clientY, ox: camRef.current.x, oy: camRef.current.y, moved: false, empty: event.button === 0 && !onNode, samples: [{ t: performance.now(), x: event.clientX, y: event.clientY }] };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (pointers.current.has(event.pointerId)) pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const pinching = pinch.current;
    if (pinching && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      touched.current = true;
      const z = clampZoom(pinching.z * (Math.hypot(a.x - b.x, a.y - b.y) / pinching.dist));
      const k = z / pinching.z;
      place({ z, x: pinching.cx - (pinching.cx - pinching.ox) * k, y: pinching.cy - (pinching.cy - pinching.oy) * k });
      return;
    }
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    const dx = event.clientX - d.px;
    const dy = event.clientY - d.py;
    if (!d.moved) {
      if (Math.hypot(dx, dy) < 4) return; // a click, not a drag
      d.moved = true;
      touched.current = true;
      setPanning(true);
    }
    d.samples.push({ t: performance.now(), x: event.clientX, y: event.clientY });
    if (d.samples.length > 6) d.samples.shift();
    place({ ...camRef.current, x: d.ox + dx, y: d.oy + dy });
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    drag.current = null;
    setPanning(false);
    if (!d.moved) {
      if (d.empty) emptyClick.current?.();
      return;
    }
    // Momentum from the last ~100ms of movement.
    const last = d.samples[d.samples.length - 1];
    const first = d.samples.find((s) => last.t - s.t <= 100) ?? d.samples[0];
    const span = Math.max(last.t - first.t, 1);
    let vx = ((last.x - first.x) / span) * 16;
    let vy = ((last.y - first.y) / span) * 16;
    if (Math.hypot(vx, vy) < 2 || performance.now() - last.t > 80) return;
    const step = () => {
      vx *= 0.93;
      vy *= 0.93;
      if (Math.hypot(vx, vy) < 0.4) { coastRaf.current = null; return; }
      const c = camRef.current;
      place({ ...c, x: c.x + vx, y: c.y + vy });
      coastRaf.current = requestAnimationFrame(step);
    };
    coastRaf.current = requestAnimationFrame(step);
  }

  /** Right/middle press must never start a text selection or open the native menu. */
  function onMouseDown(event: React.MouseEvent<HTMLDivElement>) {
    if (event.button !== 0 && !(event.target as HTMLElement).closest?.("input, textarea")) event.preventDefault();
  }

  function onContextMenu(event: React.MouseEvent<HTMLDivElement>) {
    if (!(event.target as HTMLElement).closest?.("input, textarea")) event.preventDefault();
  }

  function onDoubleClick(event: React.MouseEvent<HTMLDivElement>) {
    if (isIgnored(event.target)) return;
    const rect = event.currentTarget.getBoundingClientRect();
    zoomAtTarget(event.shiftKey ? 1 / 1.7 : 1.7, event.clientX - rect.left, event.clientY - rect.top, 0.22);
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest?.(".topo-node, path[role=button], button, input")) return;
    const step = event.shiftKey ? 160 : 56;
    const t = targetRef.current;
    if (event.key === " ") spaceRef.current = true;
    else if (event.key === "+" || event.key === "=") zoomBy(1.25);
    else if (event.key === "-" || event.key === "_") zoomBy(1 / 1.25);
    else if (event.key === "0") resetView();
    else if (event.key === "ArrowLeft") { touched.current = true; glide({ ...t, x: t.x + step }, 0.3); }
    else if (event.key === "ArrowRight") { touched.current = true; glide({ ...t, x: t.x - step }, 0.3); }
    else if (event.key === "ArrowUp") { touched.current = true; glide({ ...t, y: t.y + step }, 0.3); }
    else if (event.key === "ArrowDown") { touched.current = true; glide({ ...t, y: t.y - step }, 0.3); }
    else return;
    event.preventDefault();
  }

  function onKeyUp(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === " ") spaceRef.current = false;
  }

  function onBlur() {
    spaceRef.current = false;
  }

  return {
    cam,
    vp,
    viewportRef,
    panning,
    zoomBy,
    resetView,
    fitAll,
    flyTo,
    centerOn,
    /** Spread onto the viewport element. */
    bind: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onDoubleClick,
      onMouseDown,
      onContextMenu,
      onKeyDown,
      onKeyUp,
      onBlur,
      style: { cursor: panning ? "grabbing" : "grab", userSelect: "none" as const, WebkitUserSelect: "none" as const, touchAction: "none" as const },
    },
  };
}
