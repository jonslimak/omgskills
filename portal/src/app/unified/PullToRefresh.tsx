import { useEffect, useRef, useState, type RefObject } from "react";

/** The page follows the finger with growing resistance, never quite reaching PULL_MAX; past PULL_REFRESH, letting go refreshes. */
export const PULL_MAX = 150;
export const PULL_REFRESH = 55;
/** Room the page keeps for the spinner while refreshing: 18px under the search bar, the 22px spinner, 18px above the page (which has 6px of its own). */
export const PULL_GAP = 40;
/** The shortest time the spinner shows, so a quick answer doesn't flash it. */
export const PULL_MIN_SPIN = 600;
export const pullDistance = (dy: number) => (dy > 0 ? PULL_MAX * (1 - 1 / (dy * 0.55 / PULL_MAX + 1)) : 0);

/**
 * Pull down at the top of the page to refresh, on phones. The page scrolls inside the app's main pane,
 * so the browser's own pull-to-refresh never fires there. Like Mail, the page stays on screen and the
 * data reloads in place; the spinner turns until it arrives.
 */
export function PullToRefresh({ scroller, enabled, onRefresh }: {
  scroller: RefObject<HTMLElement | null>; enabled: boolean; onRefresh?: () => Promise<unknown>;
}) {
  const [pull, setPull] = useState(0);
  // The top of the main pane, just under the search bar: the spinner stays there while the page stretches.
  const [top, setTop] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useRef(onRefresh);
  refresh.current = onRefresh;
  const busy = useRef(false);
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
      // The A–Z rail scrubs with its own drag.
      const onRail = event.target instanceof Element && !!event.target.closest(".ua-az-anchor");
      startY = event.touches.length === 1 && element.scrollTop <= 0 && !onRail && !busy.current ? event.touches[0].clientY : null;
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
        // The browser already took the gesture (its own stretch): let it, rather than moving the page twice.
        if (!event.cancelable) { startY = null; return; }
        pulling = true;
      }
      // Pushed back up past where it started: the pull is over.
      if (dy <= 0) { reset(); return; }
      // The page moves itself (below), so the browser's own stretch would double it.
      if (!event.cancelable) { reset(); return; }
      event.preventDefault();
      distance = pullDistance(dy);
      setPull(distance);
    };
    const end = () => {
      if (startY !== null && distance >= PULL_REFRESH) {
        startY = null;
        busy.current = true;
        setRefreshing(true);
        setPull(0);
        const minimum = new Promise(resolve => setTimeout(resolve, PULL_MIN_SPIN));
        // A failed refresh still ends: the app reports its own load errors.
        void Promise.all([Promise.resolve(refresh.current?.()).catch(() => {}), minimum])
          .finally(() => { busy.current = false; setRefreshing(false); });
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
  // The page follows the finger, then settles just under the spinner while refreshing, so the spinner never covers it.
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    if (shown > 0) {
      element.dataset.ptr = refreshing ? "held" : "pulling";
      element.style.setProperty("--ua-ptr", `${refreshing ? PULL_GAP : pull}px`);
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
