import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog } from "radix-ui";
import { Search } from "lucide-react";
import type { PortalSet } from "../../app/model";
import type { SkillDisplay } from "../../app/unified/model";
import { Avatar } from "../../app/unified/Avatar";
import { setStatus } from "./set-adds";

/** Matches a search against a skill's name and description. */
export function matchesSearch(skill: SkillDisplay, query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const text = `${skill.name} ${skill.description}`.toLowerCase();
  return words.every(word => text.includes(word));
}

type Place = { left: number; width: number; top: number };

/** On wide screens the drawer covers the skill list: the main pane's width, from just under the Set's name. */
export function sheetPlace(): Place | null {
  if (!window.matchMedia("(min-width: 760px)").matches) return null;
  const main = document.getElementById("unified-main")?.getBoundingClientRect();
  if (!main) return null;
  const heading = document.querySelector(".ua-set-identity")?.getBoundingClientRect();
  // On very wide screens, no wider than the skill list (1120px plus its padding), centred in the pane.
  const width = Math.min(main.width, 1168);
  return { left: main.left + (main.width - width) / 2, width, top: Math.max(main.top, (heading?.bottom ?? main.top) + 20) };
}

/** A drawer from the bottom listing My skills, to pick several to add to a Set. */
export function SetAddSheet({ set, choices, picked, toggle, busy, disabled, error, theme, close, submit }: {
  set: PortalSet; choices: SkillDisplay[]; picked: string[]; toggle: (key: string, on: boolean) => void;
  busy: boolean; disabled: boolean; error: string; theme: string; close: () => void; submit: () => void;
}) {
  const [query, setQuery] = useState("");
  const trigger = useRef(document.activeElement as HTMLElement | null);
  const [place, setPlace] = useState(sheetPlace);
  useEffect(() => {
    // The pane changes size with the window and when the detail panel opens or closes.
    const update = () => setPlace(sheetPlace());
    const main = document.getElementById("unified-main");
    const observer = typeof ResizeObserver === "undefined" || !main ? null : new ResizeObserver(update);
    if (main) observer?.observe(main);
    window.addEventListener("resize", update);
    return () => { observer?.disconnect(); window.removeEventListener("resize", update); };
  }, []);
  // A skill with no copy to point at can't go in a Set.
  const settable = useMemo(() => choices.filter(skill => skill.installed || skill.catalogId || skill.cloudKey), [choices]);
  const shown = useMemo(() => settable.filter(skill => matchesSearch(skill, query)), [settable, query]);
  // Only picks still in My skills count; ones hidden by the search still go in.
  const count = picked.filter(key => settable.some(skill => skill.key === key)).length;
  return <Dialog.Root open onOpenChange={open => !open && close()}>
    <Dialog.Portal>
      <Dialog.Overlay className="ua-overlay" />
      <Dialog.Content className="ua-add-sheet ua-theme" data-theme={theme} data-pane={place ? true : undefined}
        style={place ? { left: place.left, width: place.width, top: place.top } : undefined} aria-describedby={undefined}
        onCloseAutoFocus={event => { event.preventDefault(); if (trigger.current?.isConnected) trigger.current.focus(); }}>
        <Dialog.Title className="ua-sr">Add skills to {set.name}</Dialog.Title>
        <div className="ua-add-sheet-bar">
          <button type="button" className="ua-pill" disabled={busy} onClick={close}>Cancel</button>
          <label className="ua-add-sheet-search">
            <Search aria-hidden="true" />
            {/* On phones the keyboard would cover the list, so the search waits for a tap. */}
            <input type="search" autoFocus={window.matchMedia("(min-width: 760px)").matches} value={query} placeholder="Search My skills" aria-label="Search My skills"
              onChange={event => setQuery(event.target.value)}
              // Enter only closes the keyboard; adding takes the Add button.
              onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} />
          </label>
          <button type="button" className="ua-pill ua-primary" disabled={disabled || !count} onClick={submit}>
            {busy ? "Adding..." : count > 1 ? `Add ${count}` : "Add"}
          </button>
        </div>
        {error && <p className="ua-add-sheet-error" role="alert">{error}</p>}
        <div className="ua-add-sheet-list" role="group" aria-label="My skills">
          {shown.map(skill => {
            const has = setStatus(set, skill) === true;
            return <label key={skill.key} className="ua-add-sheet-row" data-in-set={has || undefined}>
              <input type="checkbox" checked={has || picked.includes(skill.key)} disabled={disabled || has}
                onChange={event => toggle(skill.key, event.target.checked)} />
              <Avatar name={skill.author || skill.name} src={skill.avatar} />
              {/* The same text as a row in My skills. */}
              <span className="ua-row-text">
                <span className="ua-row-heading"><span className="ua-row-name">{skill.name}</span>
                  {has ? <span className="ua-row-versions">In set</span> : !skill.installed ? <span className="ua-row-versions">Not installed</span> : null}</span>
                <span className="ua-row-description">{skill.description}</span>
              </span>
            </label>;
          })}
          {!shown.length && <p className="ua-muted">{settable.length ? "No skills match." : "No skills in My skills yet."}</p>}
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
