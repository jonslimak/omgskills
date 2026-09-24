import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { RotateCcw } from "lucide-react";
import { PortalApp } from "../app/PortalApp";
import type { PortalActions, PortalSet } from "../app/model";
import { IconAction } from "../app/ui";
import { makeFixtures, type Scenario } from "./fixtures";
import { changeMembership } from "./state";
import "../app/redesign.css";

function Preview() {
  const [scenario, setScenario] = useState<Scenario>("populated");
  const [data, setData] = useState(() => makeFixtures());
  const [revision, setRevision] = useState(0);
  const [notice, notify] = useState("");
  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => notify(""), 3000);
    return () => clearTimeout(timeout);
  }, [notice]);
  const reset = (next: Scenario) => {
    setScenario(next);
    setData(makeFixtures(next));
    setRevision((value) => value + 1);
    notify("");
  };
  const actions: PortalActions = {
    updateSet: (id, changes) =>
      setData((current) => ({
        ...current,
        sets: current.sets.map((set) => {
          if (set.id !== id || set.role !== "owner") return set;
          if (set.isFavorites)
            return { ...set, items: changes.items ?? set.items };
          return { ...set, ...changes };
        }),
      })),
    createSet: (name, skills) => {
      const set: PortalSet = {
        id: crypto.randomUUID(),
        name,
        description: "",
        visibility: "private",
        isFavorites: false,
        hidden: false,
        role: "owner",
        ownerName: data.profile.name,
        emails: [],
        items: [],
      };
      setData((current) => ({
        ...current,
        sets: [...current.sets, changeMembership(set, skills, true)],
      }));
      notify(`Created sample set: ${name}`);
    },
    deleteSet: (id) => {
      setData((current) => ({
        ...current,
        sets: current.sets.filter(
          (set) => set.id !== id || set.isFavorites || set.role !== "owner",
        ),
      }));
      notify("Sample set deleted");
    },
    membership: (setId, skills, add) =>
      setData((current) => {
        let sets = current.sets;
        if (setId === "favorites" && !sets.some((set) => set.isFavorites))
          sets = [
            {
              id: "favorites",
              name: "Favorites",
              description: "Your public favorites.",
              visibility: "public",
              isFavorites: true,
              hidden: false,
              role: "owner",
              ownerName: current.profile.name,
              emails: [],
              items: [],
            },
            ...sets,
          ];
        return {
          ...current,
          sets: sets.map((set) =>
            set.id === setId ? changeMembership(set, skills, add) : set,
          ),
        };
      }),
    revoke: (id) => {
      setData((current) => ({
        ...current,
        devices: current.devices.map((device) =>
          device.id === id ? { ...device, status: "revoked" } : device,
        ),
      }));
      notify("Sample connection revoked");
    },
    updateProfile: (changes) =>
      setData((current) => ({
        ...current,
        profile: { ...current.profile, ...changes },
      })),
    retry: () => reset("populated"),
  };
  return (
    <PortalApp
      key={revision}
      data={data}
      actions={actions}
      state={
        scenario === "loading" || scenario === "error" ? scenario : "ready"
      }
      base="/app/preview/"
      notice={notice}
      notify={notify}
      previewBar={
        <div className="rd-preview-bar">
          <span>
            Local preview <span aria-hidden="true">·</span> sample data
          </span>
          <div>
            <label className="rd-sr-only" htmlFor="preview-scenario">
              Preview scenario
            </label>
            <select
              id="preview-scenario"
              value={scenario}
              onChange={(event) => reset(event.target.value as Scenario)}
            >
              <option value="populated">Populated</option>
              <option value="empty">Empty</option>
              <option value="loading">Loading</option>
              <option value="error">Error</option>
              <option value="long-content">Long content</option>
              <option value="connected-source">Connected source</option>
            </select>
            <IconAction
              label="Reset sample data"
              onClick={() => reset(scenario)}
            >
              <RotateCcw />
            </IconAction>
          </div>
        </div>
      }
    />
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
