import { useEffect, useRef, useState } from "react";
import type { PortalApi } from "../../portal-api";
import { createAccountSession, type AccountSnapshot } from "../account-session";
import { type AccountIdentity } from "../data";
import { managementApi } from "./management-api";
import type { SetCommand } from "../set-data";
import type { MembershipCommand } from "../membership-data";

const initial: AccountSnapshot = { data: null, refreshing: true, error: "", accessDenied: false, revision: 0, profileSaving: false, profileError: "", setSaving: false };

export function useAccount(api: PortalApi, identity: AccountIdentity, enabled: boolean, key: string) {
  const apiRef = useRef(api);
  apiRef.current = api;
  const session = useRef<ReturnType<typeof createAccountSession> | null>(null);
  const [snapshot, setSnapshot] = useState(initial);
  const [recovery, setRecovery] = useState(0);
  useEffect(() => {
    if (!enabled) { setSnapshot({ ...initial, refreshing: false }); return; }
    const account = createAccountSession({
      api: managementApi((path, init) => apiRef.current(path, init)), identity,
      cacheKey: key, changed: setSnapshot,
      // No persistent private cache in the first authenticated unified slice.
    });
    session.current = account;
    setSnapshot(account.getSnapshot());
    void account.refresh();
    const active = () => { if (!document.hidden) void account.refresh(true); };
    window.addEventListener("focus", active);
    document.addEventListener("visibilitychange", active);
    return () => {
      account.dispose();
      if (session.current === account) session.current = null;
      window.removeEventListener("focus", active);
      document.removeEventListener("visibilitychange", active);
    };
  }, [enabled, key, identity.name, identity.email, recovery]);
  return {
    snapshot,
    saveProfile: (changes: { handle?: string; published?: boolean }) => session.current
      ? session.current.saveProfile(changes) : Promise.reject(new Error("Sign in before saving.")),
    invalidate: () => session.current?.invalidateAccess(),
    saveSet: (command: SetCommand) => session.current
      ? session.current.saveSet(command) : Promise.reject(new Error("Sign in before saving.")),
    saveMembership: (command: MembershipCommand) => session.current
      ? session.current.saveMembership(command) : Promise.reject(new Error("Sign in before saving.")),
    refresh: () => { void session.current?.refresh(); },
    clear: () => { session.current?.dispose(); setSnapshot(initial); },
    recover: () => setRecovery(value => value + 1),
  };
}
