import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ClerkProvider } from "@clerk/clerk-react";
import { PortalEntry, PortalSession } from "./account/PortalSession";
import { isFeatureEnabled } from "./feature-flags";
import { normalPortalBase } from "./app/routes";
import { integrationConfigurationError } from "./integration/gate";

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const local = import.meta.env.DEV;
// Normal routes in development must use the same verified backend as /integration/.
const error = local ? (
  !["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)
    ? "The test portal requires a loopback address."
    : integrationConfigurationError({
      ready: import.meta.env.VITE_PORTAL_INTEGRATION_READY === true,
      publishableKey,
      webEnabled: import.meta.env.VITE_SKILLGROUPS_WEB_ENABLED,
    })
) : !publishableKey ? "Missing portal sign-in configuration." : null;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {error ? <PortalEntry local={local} title="Portal unavailable"><p>{error}</p></PortalEntry>
      : <ClerkProvider publishableKey={publishableKey!}>
        <PortalSession publishableKey={publishableKey!} base={normalPortalBase(location.pathname)} local={local}
          installEnabled={!local && isFeatureEnabled(import.meta.env.VITE_SKILLGROUPS_MAC_ENABLED)} />
      </ClerkProvider>}
  </StrictMode>,
);
