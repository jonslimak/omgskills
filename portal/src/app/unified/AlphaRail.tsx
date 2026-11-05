import { useEffect, useRef, useState, type RefObject } from "react";

export const railLetters = ["#", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];
/** Long lists only: below this, or when everything fits on screen, there is no rail. */
export const railMinimum = 20;
/** Space above and below the rail, which otherwise runs the full visible height of the list. */
const railInset = 12;
const railMaxHeight = 760;

/** The rail letter a skill name files under: its first letter without accents, or # for anything else. */
export function railLetter(name: string) {
  const first = name.trim().normalize("NFD").replace(/[̀-ͯ]/g, "").charAt(0).toUpperCase();
  return first >= "A" && first <= "Z" ? first : "#";
}

/** The rail letters a list of skills uses, in rail order. */
export function railLettersOf(skills: { name: string }[]) {
  const used = new Set(skills.map(skill => railLetter(skill.name)));
  return railLetters.filter(letter => used.has(letter));
}

/** The first row at or after the letter, so a letter with no skills still lands somewhere sensible. */
export function railTarget(present: string[], letter: string) {
  const start = railLetters.indexOf(letter);
  return railLetters.slice(start).find(item => present.includes(item)) ?? present[present.length - 1] ?? null;
}

/**
 * A letter index along the right edge of the list, like iOS Contacts. Tap or drag along it to jump;
 * a bubble shows the letter under the finger. Rows mark themselves with data-letter.
 */
export function AlphaRail({ scroller, letters: present, count }: { scroller: RefObject<HTMLElement | null>; letters: string[]; count: number }) {
  const rail = useRef<HTMLElement>(null);
  const [overflows, setOverflows] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [bubbleTop, setBubbleTop] = useState(0);
  const [height, setHeight] = useState(0);

  // A lifted finger anywhere ends the drag, even when the browser drops the pointer capture.
  useEffect(() => {
    if (active === null) return;
    const end = () => setActive(null);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => { window.removeEventListener("pointerup", end); window.removeEventListener("pointercancel", end); };
  }, [active]);

  // Whether the list runs past the screen, rechecked when the window or the list's content changes size.
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const measure = () => {
      setOverflows(element.scrollHeight > element.clientHeight + 1);
      setHeight(element.clientHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    const content = element.querySelector(":scope > .ua-content");
    if (content) observer.observe(content);
    return () => observer.disconnect();
  }, [scroller]);

  if (count < railMinimum || !overflows || present.length < 2) return null;

  // Full height of the visible list, centered and capped so letters don't drift apart on tall screens.
  const railHeight = Math.max(0, Math.min(height - railInset * 2, railMaxHeight));
  const railTop = (height - railHeight) / 2;
  const jump = (letter: string) => {
    const target = railTarget(present, letter);
    if (!target) return;
    setActive(letter);
    scroller.current?.querySelector<HTMLElement>(`[data-letter="${target}"]`)?.scrollIntoView({ block: "start" });
  };
  const letterAt = (y: number) => {
    const box = rail.current!.getBoundingClientRect();
    setBubbleTop(Math.min(box.height, Math.max(0, y - box.top)));
    const index = Math.floor(((y - box.top) / box.height) * railLetters.length);
    return railLetters[Math.min(railLetters.length - 1, Math.max(0, index))];
  };

  return (
    <div className="ua-az-anchor">
      <nav
        ref={rail}
        className="ua-az"
        aria-label="Jump to letter"
        style={{ height: railHeight, top: railTop }}
        data-active={active !== null}
        onPointerDown={event => {
          if (event.pointerType !== "mouse") event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          jump(letterAt(event.clientY));
        }}
        onPointerMove={event => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          const letter = letterAt(event.clientY);
          if (letter !== active) jump(letter);
        }}
        onPointerUp={() => setActive(null)}
        onPointerCancel={() => setActive(null)}
        onLostPointerCapture={() => setActive(null)}
      >
        {railLetters.map(letter => (
          <button
            key={letter}
            type="button"
            tabIndex={present.includes(letter) ? 0 : -1}
            aria-label={`Jump to ${letter === "#" ? "names that don't start with a letter" : letter}`}
            data-empty={!present.includes(letter)}
            onKeyDown={event => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              const target = railTarget(present, letter);
              if (target) scroller.current?.querySelector<HTMLElement>(`[data-letter="${target}"]`)?.scrollIntoView({ block: "start" });
            }}
          >
            {letter}
          </button>
        ))}
      </nav>
      {active && <div className="ua-az-bubble" style={{ top: railTop + bubbleTop }} aria-hidden="true">{railTarget(present, active)}</div>}
    </div>
  );
}
