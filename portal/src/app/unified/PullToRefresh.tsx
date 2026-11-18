import { useEffect, useRef, useState, type RefObject } from "react";

/** The page follows the finger with growing resistance, never quite reaching PULL_MAX; past PULL_REFRESH, letting go refreshes. */
export const PULL_MAX = 150;
export const PULL_REFRESH = 55;
/** Room the page keeps for the spinner while refreshing: 18px under the search bar, the 22px spinner, 18px above the page (which has 6px of its own). */
export const PULL_GAP = 40;
/** The shortest time the spinner shows, so a quick answer doesn't flash it. */
export const PULL_MIN_SPIN = 600;
/** The longest the page waits on a slow answer before it lets go; the data still lands when it arrives. */
export const PULL_MAX_SPIN = 12000;
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
  const canRefresh = !!onRefresh;
  useEffect(() => {
    const element = scroller.current;
    // Nothing to reload (signed out): no pull.
    if (!element || !enabled || !refresh.current) return;
    let startX = 0;
    let startY: number | null = null;
    let distance = 0;
    // Set once the finger has moved a little: a pull, or not (then the gesture is left to the page).
    let pulling = false;
    let fromHeld = false;
    const reset = () => { startY = null; distance = 0; pulling = false; setPull(0); };
    const start = (event: TouchEvent) => {
      setTop(element.getBoundingClientRect().top);
      // The A–Z rail scrubs with its own drag.
      const onRail = event.target instanceof Element && !!event.target.closest(".ua-az-anchor");
      startY = event.touches.length === 1 && element.scrollTop <= 0 && !onRail ? event.touches[0].clientY : null;
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
        // Barely moved (a tap's jitter, a finger landing): wait, and leave the gesture alone.
        if (Math.abs(dy) < 3 && dx < 3) return;
        // Not clearly down (upward, a carousel, a diagonal), or a page that has scrolled: not a pull, and the page keeps the gesture.
        if (dy <= 0 || dx * 2 > dy || element.scrollTop > 0) { startY = null; return; }
        // The browser already took the gesture (its own stretch): let it, rather than moving the page twice.
        if (!event.cancelable) { startY = null; return; }
        // Claim it on the very first move down: Safari keeps any gesture whose first move it was allowed to scroll,
        // and the pull would then stick until the next try.
        event.preventDefault();
        pulling = true;
        // Started while refreshing: the page is held down for the spinner and moves on from there, to the end of this touch.
        fromHeld = busy.current;
      }
      // Pushed back up past where it started: the pull is over.
      if (dy <= 0) { reset(); return; }
      // The page moves itself (below), so the browser's own stretch would double it.
      if (!event.cancelable) { reset(); return; }
      event.preventDefault();
      distance = pullDistance(dy);
      setPull(fromHeld ? PULL_GAP + distance : distance);
    };
    const end = () => {
      // A pull during a refresh just lets go; the refresh under way carries on.
      if (startY !== null && distance >= PULL_REFRESH && !busy.current) {
        startY = null;
        busy.current = true;
        setRefreshing(true);
        setPull(0);
        const minimum = new Promise(resolve => setTimeout(resolve, PULL_MIN_SPIN));
        // A failed refresh still ends (the app reports its own load errors), and a stalled one gives up.
        const answer = Promise.race([Promise.resolve().then(() => refresh.current?.()).catch(() => {}),
          new Promise(resolve => setTimeout(resolve, PULL_MAX_SPIN))]);
        void Promise.all([answer, minimum])
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
  }, [scroller, enabled, canRefresh]);
  const shown = refreshing ? PULL_REFRESH : pull;
  // The page follows the finger, then settles just under the spinner while refreshing, so the spinner never covers it.
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    if (shown > 0) {
      // Pulled again while refreshing: the page follows the finger from where it is held.
      element.dataset.ptr = pull ? "pulling" : "held";
      element.style.setProperty("--ua-ptr", `${pull || PULL_GAP}px`);
      return;
    }
    if (!element.dataset.ptr) return;
    // Let go short of a refresh: the page slides back, then the move is dropped.
    element.dataset.ptr = "back";
    element.style.setProperty("--ua-ptr", "0px");
    const timer = setTimeout(() => { delete element.dataset.ptr; element.style.removeProperty("--ua-ptr"); }, 220);
    return () => clearTimeout(timer);
  }, [scroller, shown, pull, refreshing]);
  // A refresh under way keeps its spinner even if the pull turns off meanwhile (a save, a selection).
  if (!refreshing && (!enabled || !pull)) return null;
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
