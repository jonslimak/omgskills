import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ClerkProvider } from "@clerk/clerk-react";
import { UnifiedSession } from "./integration/unified/Session";
import { normalPortalBase } from "./app/routes";
import { connectedInventoryTest, inventoryReconciliationTest } from "./connected-inventory-runtime";
import { productionConnectedProfile } from "./production-connected";

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const base = normalPortalBase(location.pathname);
const production = productionConnectedProfile(location.href, publishableKey);
// Clean public addresses only for the normal production app at /app/ (urls.md U-01):
// test entries, the Mac pilot site and app.omgskills.com keep ?view=.
const cleanPaths = !import.meta.env.DEV && base === "/app/" && !connectedInventoryTest;
createRoot(document.getElementById("root")!).render(<StrictMode>
  {!publishableKey ? <main><h1>Portal unavailable</h1><p>Missing sign-in configuration.</p></main>
    : <ClerkProvider publishableKey={publishableKey}><UnifiedSession base={base} cleanPaths={cleanPaths} publicFirst={cleanPaths} local={connectedInventoryTest}
      productionInstall={production.sync} connectedInventory={connectedInventoryTest || production.inventory}
      inventoryReconciliation={inventoryReconciliationTest || production.inventory} /></ClerkProvider>}
</StrictMode>);
