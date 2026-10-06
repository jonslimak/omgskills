import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ClerkProvider } from "@clerk/clerk-react";
import { UnifiedSession } from "./integration/unified/Session";
import { normalPortalBase } from "./app/routes";

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
createRoot(document.getElementById("root")!).render(<StrictMode>
  {!publishableKey ? <main><h1>Portal unavailable</h1><p>Missing sign-in configuration.</p></main>
    : <ClerkProvider publishableKey={publishableKey}><UnifiedSession base={normalPortalBase(location.pathname)} local={false} /></ClerkProvider>}
</StrictMode>);
