import { useEffect, useRef, useState, type RefObject } from "react";

/** How far the indicator follows the finger, and how far a pull must go to refresh. */
export const PULL_MAX = 80;
export const PULL_REFRESH = 60;
/** The indicator moves at half the finger's speed, up to PULL_MAX. */
/** Room the page makes for the spinner: 18px under the search bar, the 22px spinner, 18px above the page (which has 6px of its own). */
export const PULL_GAP = 40;
export const pullDistance = (dy: number) => (dy > 0 ? Math.min(PULL_MAX, dy / 2) : 0);

/**
 * Pull down at the top of the page to refresh, on phones. The page scrolls inside the app's main pane,
 * so the browser's own pull-to-refresh never fires there.
 */
export function PullToRefresh({ scroller, enabled, onRefresh = () => window.location.reload() }: {
  scroller: RefObject<HTMLElement | null>; enabled: boolean; onRefresh?: () => void;
}) {
  const [pull, setPull] = useState(0);
  // The top of the main pane, just under the search bar: the spinner stays there while the page stretches.
  const [top, setTop] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useRef(onRefresh);
  refresh.current = onRefresh;
  useEffect(() => {
    const element = scroller.current;
    if (!element || !enabled) return;
    let startX = 0;
    let startY: number | null = null;
    let distance = 0;
    // Set once the finger has moved a little: a pull, or not (then the gesture is left to the page).
    let pulling = false;
    const reset = () => { startY = null; distance = 0; pulling = false; setPull(0); };
    const start = (event: TouchEvent) => {
      setTop(element.getBoundingClientRect().top);
      startY = event.touches.length === 1 && element.scrollTop <= 0 ? event.touches[0].clientY : null;
      startX = event.touches[0]?.clientX ?? 0;
      distance = 0;
      pulling = false;
    };
    const move = (event: TouchEvent) => {
      if (startY === null) return;
      // A second finger ends the pull.
      if (event.touches.length !== 1) { reset(); return; }
      const dy = event.touches[0].clientY - startY;
      const dx = Math.abs(event.touches[0].clientX - startX);
      if (!pulling) {
        if (dx < 8 && Math.abs(dy) < 8) return;
        // Mostly sideways (a carousel), upward, or a page that has scrolled: not a pull, and the page keeps the gesture.
        if (dy <= 0 || dx > dy || element.scrollTop > 0) { startY = null; return; }
        pulling = true;
      }
      // Pushed back up past where it started: the pull is over.
      if (dy <= 0) { reset(); return; }
      // The page moves itself (below), so the browser's own stretch would double it.
      if (event.cancelable) event.preventDefault();
      distance = pullDistance(dy);
      setPull(distance);
    };
    const end = () => {
      if (startY !== null && distance >= PULL_REFRESH) {
        startY = null;
        setRefreshing(true);
        refresh.current();
      } else reset();
    };
    element.addEventListener("touchstart", start, { passive: true });
    element.addEventListener("touchmove", move, { passive: false });
    element.addEventListener("touchend", end);
    element.addEventListener("touchcancel", reset);
    return () => {
      element.removeEventListener("touchstart", start);
      element.removeEventListener("touchmove", move);
      element.removeEventListener("touchend", end);
      element.removeEventListener("touchcancel", reset);
      setPull(0);
    };
  }, [scroller, enabled]);
  const shown = refreshing ? PULL_REFRESH : pull;
  // The page moves down by the pull, and stays down while refreshing, so the spinner never covers it.
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    if (shown > 0) {
      element.dataset.ptr = pull && !refreshing ? "pulling" : "held";
      element.style.setProperty("--ua-ptr", `${Math.min(PULL_GAP, shown)}px`);
      return;
    }
    if (!element.dataset.ptr) return;
    // Let go short of a refresh: the page slides back, then the move is dropped.
    element.dataset.ptr = "back";
    element.style.setProperty("--ua-ptr", "0px");
    const timer = setTimeout(() => { delete element.dataset.ptr; element.style.removeProperty("--ua-ptr"); }, 220);
    return () => clearTimeout(timer);
  }, [scroller, shown, pull, refreshing]);
  if (!enabled || (!pull && !refreshing)) return null;
  return <div className="ua-ptr" style={{ top }} data-ready={refreshing || pull >= PULL_REFRESH}>
    <span className="ua-ptr-dot" style={{ transform: `translateY(6px) scale(${0.6 + 0.4 * Math.min(1, shown / PULL_REFRESH)})`, opacity: Math.min(1, shown / PULL_REFRESH) }}>
      {/* The iPhone's spokes: they appear one by one as you pull, then turn while refreshing. */}
      <span className="ua-ptr-spokes" aria-hidden="true" data-spinning={refreshing || undefined}>
        {Array.from({ length: 8 }, (_, index) => <i key={index}
          style={{ transform: `rotate(${index * 45}deg)`, visibility: refreshing || index < Math.ceil(8 * shown / PULL_REFRESH) ? "visible" : "hidden" }} />)}
      </span>
    </span>
    {refreshing && <span className="ua-sr" role="status">Refreshing</span>}
  </div>;
}
