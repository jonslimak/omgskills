import { CatalogInstallIntentStore } from "../../app/unified/catalog-install-intent";
import type { SkillDisplay } from "../../app/unified/model";
import { InstallIntentStore } from "../../app/unified/install-intent";
import { type InstallClient } from "../../app/unified/public-install";
import { PublicInstallSetup as SharedInstallSetup } from "../../app/unified/PublicInstallSetup";
import { f2Cases, f2InstallAction } from "./f2-install";

export { refreshInstallSkill } from "../../app/unified/PublicInstallSetup";

export function createPreviewInstallStore(client: InstallClient = "f1") {
  return new InstallIntentStore(() => window.sessionStorage, client);
}

/** The production install card's store, for the plain preview's signed-in state. */
export function createPreviewCatalogStore() {
  return new CatalogInstallIntentStore(() => window.sessionStorage, "production");
}

export function PublicInstallSetup({ skill, detailReady, caseKey, returnRoute, store, client = "f1" }: {
  skill: SkillDisplay; detailReady: boolean; caseKey: string; returnRoute: string; store: InstallIntentStore;
  client?: InstallClient;
}) {
  return <SharedInstallSetup skill={skill} detailReady={detailReady} client={client} store={store}
    commit={f2Cases.find(item => item.key === caseKey)?.commit} returnRoute={returnRoute}
    action={candidate => f2InstallAction(candidate, caseKey, client)} />;
}
