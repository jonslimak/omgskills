import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ClerkProvider } from "@clerk/clerk-react";
import { UnifiedSession } from "./integration/unified/Session";
import { normalPortalBase } from "./app/routes";
import { connectedInventoryTest, inventoryReconciliationTest } from "./connected-inventory-runtime";

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const base = normalPortalBase(location.pathname);
// Clean public addresses only for the normal production app at /app/ (urls.md U-01):
// test entries, the Mac pilot site and app.omgskills.com keep ?view=.
const cleanPaths = !import.meta.env.DEV && base === "/app/" && !connectedInventoryTest;
createRoot(document.getElementById("root")!).render(<StrictMode>
  {!publishableKey ? <main><h1>Portal unavailable</h1><p>Missing sign-in configuration.</p></main>
    : <ClerkProvider publishableKey={publishableKey}><UnifiedSession base={base} cleanPaths={cleanPaths} local={connectedInventoryTest} connectedInventory={connectedInventoryTest} inventoryReconciliation={inventoryReconciliationTest} /></ClerkProvider>}
</StrictMode>);
