import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ClerkProvider } from "@clerk/clerk-react";
import { PortalEntry, PortalSession } from "../account/PortalSession";
import { integrationConfigurationError } from "./gate";

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const configurationError = integrationConfigurationError({
  ready: import.meta.env.VITE_PORTAL_INTEGRATION_READY === true,
  publishableKey,
  webEnabled: import.meta.env.VITE_SKILLGROUPS_WEB_ENABLED,
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {configurationError ? <PortalEntry local title="Test environment required"><p>{configurationError}</p></PortalEntry>
      : <ClerkProvider publishableKey={publishableKey!}>
        <PortalSession publishableKey={publishableKey!} base="/app/integration/" local installEnabled={false} />
      </ClerkProvider>}
  </StrictMode>,
);
