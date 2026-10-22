import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConnectedCandidateApp, type ConnectedCandidateInput } from "./connected-app";
import "../styles.css";

declare const __OMGSKILLS_CONNECTED_CANDIDATE__: ConnectedCandidateInput;

const configuration = typeof __OMGSKILLS_CONNECTED_CANDIDATE__ === "undefined"
  ? { profile: undefined, publishableKey: undefined, clerkFrontendOrigin: undefined }
  : __OMGSKILLS_CONNECTED_CANDIDATE__;

createRoot(document.getElementById("root")!).render(<StrictMode>
  <ConnectedCandidateApp configuration={configuration} />
</StrictMode>);
