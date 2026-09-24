import type { PortalApi } from "../portal-api";
import type { PortalData, PortalSet } from "../app/model";
import { loadAccountData, loadSetData, readOnlyApi, type AccountIdentity } from "./data";

// Cancellation also guards transports that finish after abort or account changes.
export function startAccountRead(
  api: PortalApi,
  identity: AccountIdentity,
  success: (data: PortalData) => void,
  failure: (error: unknown) => void,
) {
  const controller = new AbortController();
  let active = true;
  void loadAccountData(readOnlyApi(api, controller.signal), identity).then(
    (data) => {
      if (active) success(data);
    },
    (error) => {
      if (active) failure(error);
    },
  );
  return () => {
    active = false;
    controller.abort();
  };
}

export function startSetRead(
  api: PortalApi,
  groupId: string,
  success: (set: PortalSet) => void,
  failure: (error: unknown) => void,
) {
  const controller = new AbortController();
  let active = true;
  void loadSetData(readOnlyApi(api, controller.signal), groupId).then(
    (set) => { if (active) success(set); },
    (error) => { if (active) failure(error); },
  );
  return () => {
    active = false;
    controller.abort();
  };
}
