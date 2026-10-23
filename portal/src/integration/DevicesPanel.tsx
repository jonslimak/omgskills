import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Laptop, RefreshCw } from "lucide-react";
import type { PortalApi } from "../portal-api";
import { Action, EmptyState, IconAction, Modal, StatusBadge } from "../app/ui";
import { createDeviceSession, type Device, type DeviceSnapshot } from "./device-session";
import { ConnectionDialog } from "./ConnectionDialog";
import type { PortalDevice } from "../app/model";
import { inventoryCoverageSummary } from "../app/unified/model";

const formatDate = (value: string | null) => value === null ? "Never"
  : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
const formatInventoryDate = (value: string | null) => value === null ? "Never"
  : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

export function DevicesPanel({ api, denied, local = true, readOnly = false, browserConnection = false, theme, inventoryDevices, sessionKey = "default" }: { api: PortalApi; denied: () => void; local?: boolean; readOnly?: boolean; browserConnection?: boolean; theme?: string; inventoryDevices?: PortalDevice[]; sessionKey?: string }) {
  const callbacks = useRef({ api, denied });
  callbacks.current = { api, denied };
  const sessionRef = useRef<ReturnType<typeof createDeviceSession> | null>(null);
  const [state, setState] = useState<DeviceSnapshot>({ devices: null, loading: true, revoking: null, error: "", notice: "" });
  const [confirm, setConfirm] = useState<Device | null>(null);
  const [connecting, setConnecting] = useState(false);
  useEffect(() => {
    const session = createDeviceSession((path, init) => callbacks.current.api(path, init), setState, () => callbacks.current.denied());
    sessionRef.current = session;
    setState(session.getSnapshot()); setConfirm(null); setConnecting(false);
    void session.refresh();
    const refresh = () => { if (!document.hidden) void session.refresh(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      session.dispose(); if (sessionRef.current === session) sessionRef.current = null;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [sessionKey]);
  useEffect(() => {
    if (state.error || (confirm && !state.devices?.some((d) => d.id === confirm.id && d.status !== "revoked"))) setConfirm(null);
  }, [state.error, state.devices, confirm]);
  const busy = state.loading || Boolean(state.revoking);
  return <section aria-label="Connected devices">
    <div className="rd-section-heading"><h2>Connected devices</h2>
      <IconAction label="Refresh devices" disabled={busy} onClick={() => void sessionRef.current?.refresh()}><RefreshCw /></IconAction>
      {!readOnly && <Action disabled={busy || Boolean(state.error)} onClick={() => setConnecting(true)}>Connect app</Action>}
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
          {inventoryDevices && <p>Last reported {formatInventoryDate(inventoryDevices.find(item => item.id === device.id)?.lastReportedAt ?? null)}
            {device.status !== "active" && " - Last known inventory retained"}</p>}
          {inventoryDevices?.find(item => item.id === device.id)?.lastCheckedAt !== undefined && <p>
            Last checked {inventoryDevices.find(item => item.id === device.id)?.lastCheckedAt == null ? "Unknown"
              : formatInventoryDate(inventoryDevices.find(item => item.id === device.id)?.lastCheckedAt ?? null)}
          </p>}
          {inventoryDevices?.find(item => item.id === device.id)?.scanCoverage !== undefined && <p>
            {inventoryCoverageSummary(inventoryDevices.find(item => item.id === device.id)?.scanCoverage)}
          </p>}
        </div>
        <StatusBadge>{device.status}</StatusBadge>
        {!readOnly && device.status !== "revoked" && <Action variant="destructive" disabled={busy || Boolean(state.error)}
          aria-label={`Revoke ${device.deviceName}`} onClick={() => setConfirm(device)}>Revoke</Action>}
      </div>)}
    </div>
    {state.devices?.length === 0 && !state.loading && !state.error && <EmptyState title="No connected devices" />}
    {!readOnly && connecting && (browserConnection
      ? <Modal title="Connect OMGSkills" theme={theme} close={() => setConnecting(false)}>
        <p>Open OMGSkills and choose Connect account. Review and approve the connection in your browser.</p>
        <Action asChild><a href="omgskills://connect"><ArrowUpRight /> Open OMGSkills</a></Action>
      </Modal>
      : <ConnectionDialog api={api} denied={denied} local={local} theme={theme} close={() => setConnecting(false)} />)}
    {!readOnly && confirm && <Modal title={`Revoke ${confirm.deviceName}?`} theme={theme} close={() => { if (!state.revoking) setConfirm(null); }}>
      <p>This stops this connection from accessing your account. Installed skills and sets are not deleted. Reconnect the app to use it again.</p>
      <div className="rd-dialog-footer"><Action disabled={busy} onClick={() => setConfirm(null)}>Cancel</Action>
        <Action variant="destructive" disabled={busy || Boolean(state.error)} onClick={() => {
          void sessionRef.current?.revoke(confirm.id).catch(() => {});
        }}>{state.revoking ? "Revoking..." : "Revoke connection"}</Action></div>
    </Modal>}
  </section>;
}
