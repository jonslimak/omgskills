import { useEffect, useRef, useState } from "react";
import type { PortalApi } from "../portal-api";
import type { PortalActions, PortalSet } from "../app/model";
import { SetDetailPage } from "../app/SetDetailPage";
import { Action, EmptyState } from "../app/ui";
import { startSetRead } from "./read-session";

const noOp = () => {};

export function ReadOnlySetDetail({ groupId, api, actions, hasSummary }: {
  groupId: string;
  api: PortalApi;
  actions: PortalActions;
  hasSummary: boolean;
}) {
  const apiRef = useRef(api);
  apiRef.current = api;
  const [set, setSet] = useState<PortalSet | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setSet(null);
    setFailed(false);
    return startSetRead(apiRef.current, groupId, setSet, () => setFailed(true));
  }, [groupId, attempt]);

  if (failed) return (
    <EmptyState title="Could not load this set" description="It may be unavailable or you may no longer have access.">
      <Action onClick={() => setAttempt((value) => value + 1)}>Try again</Action>
    </EmptyState>
  );
  if (!set || set.id !== groupId) return <p role="status">Loading set...</p>;
  return <>
    {!hasSummary && <h2>{set.name}</h2>}
    <SetDetailPage set={set} sets={[]} skills={[]} actions={actions}
      readOnly edit={false} addSkills={noOp} notify={noOp} star={noOp} newSet={noOp} />
  </>;
}
