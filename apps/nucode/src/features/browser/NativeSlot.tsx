import { useEffect, useRef, useState } from "react";
import { browserNativeBounds } from "@services/tauri";
import { nativeOverlayIntersects, trackNativeDragOverlay } from "@/features/design-system/nativeOverlays";

export function roundedRect(rect: DOMRect) {
  return { x: Math.max(0, Math.round(rect.x)), y: Math.max(0, Math.round(rect.y)), w: Math.max(1, Math.round(rect.width)), h: Math.max(1, Math.round(rect.height)) };
}
// The page was closed (by the agent or another window) between the last state update and this placement; the next
// state removes it, so this is not an error to show.
const closedTab = (error: unknown) => /Unknown browser tab/.test(String(error));
// Each placement is its own async task in the backend, so two calls in flight can take its lock in either order: a
// show sent just before the pane unmounted could land after the unmount's hide and leave the page drawn over
// whatever replaced the pane. Every slot in this window sends through one queue, one call at a time, in order.
let tail: Promise<void> | null = null;
function place(tabId: string, rect: ReturnType<typeof roundedRect>, visible: boolean) {
  const send = () => browserNativeBounds(tabId, rect, visible);
  const call = tail ? tail.then(send) : send();
  const settled = call.then(() => {}, () => {});
  tail = settled;
  void settled.then(() => { if (tail === settled) tail = null; });
  return call;
}
// The rectangle the backend gives the page while an agent has set its width (fit_viewport in policy.rs): that width,
// scaled down to fit a narrower pane, centred and top-aligned, its height clipped to the pane. The last snapshot was
// taken of that rectangle, so it is drawn there too; stretched over the whole pane it showed around the page.
export function viewportStyle(viewport?: { width: number; height?: number | null } | null) {
  if (!viewport) return undefined;
  const width = `min(100cqw, ${viewport.width}px)`;
  return { width, height: viewport.height ? `min(100cqh, calc(${width} * ${viewport.height / viewport.width}))` : "100%", margin: "0 auto" };
}
export function NativeSlot({ tabId, snapshot, ready, blocked, onError, viewport }: { tabId: string; snapshot?: string; ready: boolean; blocked: boolean; onError: (error: string) => void; viewport?: { width: number; height?: number | null } | null }) {
  const slot = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    const element = slot.current;
    if (!element || !tabId) return;
    const stopDrag = trackNativeDragOverlay();
    let frame = 0, disposed = false, pending = false, last = "";
    let rect = roundedRect(element.getBoundingClientRect());
    // IPC is sent only when rounded bounds/visibility change, one call at a time.
    const sync = () => {
      if (disposed) return;
      const bounds = element.getBoundingClientRect();
      rect = roundedRect(bounds);
      // Placement lets the backend recreate evicted tabs; it gates showing on ready.
      const visible = !blocked && !document.hidden && bounds.width > 0 && bounds.height > 0 && bounds.x >= 0 && bounds.y >= 0 && !nativeOverlayIntersects(bounds);
      const hidden = !ready || !visible;
      setHidden(old => old === hidden ? old : hidden);
      const key = JSON.stringify([rect, visible, window.innerWidth, window.innerHeight]);
      if (pending || key === last) return;
      pending = true; last = key;
      // A drag outpaces the round trip; send the newest bounds as soon as this one lands.
      void place(tabId, rect, visible).catch(e => { if (!disposed && !closedTab(e)) onError(String(e)); }).finally(() => { pending = false; sync(); });
    };
    // One measurement per frame covers ancestor scrolls, transitions, mode changes and overlays.
    const measure = () => { if (disposed) return; sync(); frame = requestAnimationFrame(measure); };
    frame = requestAnimationFrame(measure);
    // Resizer drags change the size after this frame's measurement ran; sync right after layout
    // instead of a frame later, so the page keeps up with the panel edge.
    const observer = new ResizeObserver(sync);
    observer.observe(element);
    return () => { disposed = true; stopDrag(); cancelAnimationFrame(frame); observer.disconnect(); void place(tabId, rect, false).catch(() => {}); };
  }, [tabId, ready, blocked, onError]);
  return <div ref={slot} className="browser-native-slot" data-native-hidden={hidden} aria-label="Native browser page">
    {snapshot && <img className="browser-native-snapshot" style={viewportStyle(viewport)} src={snapshot.startsWith("data:") ? snapshot : `data:image/png;base64,${snapshot}`} alt="Last page snapshot" />}
    {!ready && !blocked && <div className="browser-empty">Loading page…</div>}
  </div>;
}
