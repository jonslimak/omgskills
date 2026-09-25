import { useEffect, useRef, useState } from "react";
import { Copy } from "lucide-react";
import type { PortalApi } from "../portal-api";
import { Action, IconAction, Modal, TextInput } from "../app/ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { createConnectionSession, type ConnectionSnapshot } from "./connection-session";

export function ConnectionDialog({ api, denied, close, local = true }: { api: PortalApi; denied: () => void; close: () => void; local?: boolean }) {
  const callbacks = useRef({ api, denied }); callbacks.current = { api, denied };
  const session = useRef<ReturnType<typeof createConnectionSession> | null>(null);
  const [state, setState] = useState<ConnectionSnapshot>({ mode: "pairing", secret: "", expiresAt: "",
    generating: false, copying: false, error: "", notice: "" });
  useEffect(() => {
    const current = createConnectionSession((path, init) => callbacks.current.api(path, init), setState, () => callbacks.current.denied());
    session.current = current;
    const timer = setInterval(current.expire, 1000);
    window.addEventListener("focus", current.expire);
    document.addEventListener("visibilitychange", current.expire);
    return () => {
      current.dispose(); session.current = null; clearInterval(timer);
      window.removeEventListener("focus", current.expire);
      document.removeEventListener("visibilitychange", current.expire);
    };
  }, []);
  const label = state.mode === "pairing" ? "Connection code" : "Legacy token";
  return <Modal title="Connect app" close={() => { session.current?.dispose(); close(); }}>
    {local ? <p>Local test only. Do not paste these codes into your installed app.</p>
      : <p>Paste the code into the app to connect this account.</p>}
    <Tabs value={state.mode} onValueChange={(value) => { if (value === "pairing" || value === "legacy") session.current?.select(value); }}>
      <TabsList aria-label="Connection method"><TabsTrigger value="pairing">Connection code</TabsTrigger>
        <TabsTrigger value="legacy">Legacy token</TabsTrigger></TabsList>
      <TabsContent value="pairing"><p>One-time code for a persistent app connection.</p></TabsContent>
      <TabsContent value="legacy"><p>One-time sync token for older app versions.</p></TabsContent>
    </Tabs>
    {!state.secret && <Action variant="default" disabled={state.generating} onClick={() => void session.current?.generate()}>
      {state.generating ? "Generating..." : state.mode === "pairing" ? "Generate connection code" : "Generate legacy token"}</Action>}
    {state.secret && <>
      <div className="rd-actions"><TextInput aria-label={label} type="password" readOnly autoComplete="off" value={state.secret} />
        <IconAction label={`Copy ${label.toLowerCase()}`} disabled={state.copying}
          onClick={() => void session.current?.copy((text) => navigator.clipboard.writeText(text))}><Copy /></IconAction></div>
      <p>Expires {new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(new Date(state.expiresAt))}. Works once.</p>
    </>}
    {state.error && <p role="alert">{state.error}</p>}
    {state.notice && <p role="status">{state.notice}</p>}
    <p className="rd-muted">Closing clears this screen, but does not revoke an issued code.</p>
  </Modal>;
}
