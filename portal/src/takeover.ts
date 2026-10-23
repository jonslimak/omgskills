// Static-page takeover (urls.md step 2, item 2). A static library page ships its own
// content in #omgskills-static and an empty, hidden #root. The app renders into #root
// while the static content stays visible, then swaps in once its first public view is
// ready. If the app never becomes ready, the static page simply stays. The static page's
// own styles are marked data-omgskills-static and removed with it: they target page-wide
// elements (main, header) that the app also uses.
export const appReadyEvent = "omgskills:app-ready";
const nearTop = 200;

export function startTakeover(doc: Document = document, win: Window = window) {
  const staticPage = doc.getElementById("omgskills-static");
  const root = doc.getElementById("root");
  if (!staticPage || !root) return false;
  let swapped = false;
  const swap = () => {
    if (swapped) return;
    swapped = true;
    win.removeEventListener("scroll", whenNearTop);
    staticPage.remove();
    doc.querySelectorAll("[data-omgskills-static]").forEach(element => element.remove());
    root.hidden = false;
    win.scrollTo(0, 0);
  };
  // Never move the page under a reader: if they have scrolled down, wait until they
  // are back near the top.
  const whenNearTop = () => { if (win.scrollY < nearTop) swap(); };
  win.addEventListener(appReadyEvent, () => {
    if (win.scrollY < nearTop) swap();
    else win.addEventListener("scroll", whenNearTop, { passive: true });
  }, { once: true });
  return true;
}

/** Called by the app once its first public view has rendered. Prefer the next frame,
 * but don't depend on it: browsers pause frames for windows that aren't painted. */
export function announceAppReady(win: Window = window) {
  let sent = false;
  const send = () => { if (!sent) { sent = true; win.dispatchEvent(new Event(appReadyEvent)); } };
  win.requestAnimationFrame(send);
  win.setTimeout(send, 100);
}
