import { useEffect, useRef, useState } from "react";
import { Laptop, RefreshCw } from "lucide-react";
import type { PortalApi } from "../portal-api";
import { Action, EmptyState, IconAction, Modal, StatusBadge } from "../app/ui";
import { createDeviceSession, type Device, type DeviceSnapshot } from "./device-session";
import { ConnectionDialog } from "./ConnectionDialog";

const formatDate = (value: string | null) => value === null ? "Never"
  : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));

export function DevicesPanel({ api, denied, local = true, readOnly = false }: { api: PortalApi; denied: () => void; local?: boolean; readOnly?: boolean }) {
  const callbacks = useRef({ api, denied });
  callbacks.current = { api, denied };
  const sessionRef = useRef<ReturnType<typeof createDeviceSession> | null>(null);
  const [state, setState] = useState<DeviceSnapshot>({ devices: null, loading: true, revoking: null, error: "", notice: "" });
  const [confirm, setConfirm] = useState<Device | null>(null);
  const [connecting, setConnecting] = useState(false);
  useEffect(() => {
    const session = createDeviceSession((path, init) => callbacks.current.api(path, init), setState, () => callbacks.current.denied());
    sessionRef.current = session;
    void session.refresh();
    const refresh = () => { if (!document.hidden) void session.refresh(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      session.dispose(); sessionRef.current = null;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  useEffect(() => {
    if (state.error || (confirm && !state.devices?.some((d) => d.id === confirm.id && d.status !== "revoked"))) setConfirm(null);
  }, [state.error, state.devices, confirm]);
  const busy = state.loading || Boolean(state.revoking);
  return <section aria-label="Connected devices">
    <div className="rd-section-heading"><h2>Connected devices</h2>
      <IconAction label="Refresh devices" disabled={busy} onClick={() => void sessionRef.current?.refresh()}><RefreshCw /></IconAction>
      <Action disabled={readOnly || busy || Boolean(state.error)} onClick={() => setConnecting(true)}>Connect app</Action>
    </div>
    {state.error && <p role="alert">{state.error}</p>}
    {state.notice && <p role="status">{state.notice}</p>}
    {state.loading && !state.devices && <p role="status">Loading devices...</p>}
    <div className="rd-list">
      {state.devices?.map((device) => <div className="rd-agent-row" key={device.id}>
        <span className="rd-agent-tile rd-agent-large"><Laptop /></span>
        <div className="rd-grow"><div className="rd-row-title">{device.deviceName}</div>
          <p>Last active {formatDate(device.lastUsedAt)}</p>
          <p>Connected {formatDate(device.createdAt)} · Expires {formatDate(device.expiresAt)}</p>
        </div>
        <StatusBadge>{device.status}</StatusBadge>
        {device.status !== "revoked" && <Action variant="destructive" disabled={readOnly || busy || Boolean(state.error)}
          aria-label={`Revoke ${device.deviceName}`} onClick={() => setConfirm(device)}>Revoke</Action>}
      </div>)}
    </div>
    {state.devices?.length === 0 && !state.loading && !state.error && <EmptyState title="No connected devices" />}
    {!readOnly && connecting && <ConnectionDialog api={api} denied={denied} local={local} close={() => setConnecting(false)} />}
    {!readOnly && confirm && <Modal title={`Revoke ${confirm.deviceName}?`} close={() => { if (!state.revoking) setConfirm(null); }}>
      <p>This stops this connection from accessing your account. Installed skills and sets are not deleted. Reconnect the app to use it again.</p>
      <div className="rd-dialog-footer"><Action disabled={busy} onClick={() => setConfirm(null)}>Cancel</Action>
        <Action variant="destructive" disabled={busy || Boolean(state.error)} onClick={() => {
          void sessionRef.current?.revoke(confirm.id).catch(() => {});
        }}>{state.revoking ? "Revoking..." : "Revoke connection"}</Action></div>
    </Modal>}
  </section>;
}
