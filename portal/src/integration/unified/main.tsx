import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ClerkProvider } from "@clerk/clerk-react";
import { integrationConfigurationError } from "../gate";
import { UnifiedSession } from "./Session";

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const error = integrationConfigurationError({
  ready: import.meta.env.VITE_PORTAL_INTEGRATION_READY === true,
  publishableKey, webEnabled: import.meta.env.VITE_SKILLGROUPS_WEB_ENABLED,
});
createRoot(document.getElementById("root")!).render(<StrictMode>
  {error ? <main><h1>Test environment required</h1><p>{error}</p></main>
    : <ClerkProvider publishableKey={publishableKey!}><UnifiedSession /></ClerkProvider>}
</StrictMode>);
