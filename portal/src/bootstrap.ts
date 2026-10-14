import { isLocalPreview } from "./app/preview-gate";
import { isLocalIntegration } from "./integration/gate";
import { isFeatureEnabled, portalSurface } from "./feature-flags";
import { isReviewRoute } from "./app/routes";
import { normalInstallClient, catalogInstallTestEnabled } from "./app/unified/public-install";

// A production build must never import sample data or bypass Clerk.
if (
  import.meta.env.DEV &&
  isLocalPreview({
    development: import.meta.env.DEV,
    enabled: import.meta.env.VITE_PORTAL_PREVIEW,
    hostname: location.hostname,
    pathname: location.pathname,
  })
) {
  if (/^\/app\/preview\/unified(?:\/|$)/.test(location.pathname)) {
    void import("./preview/unified/main");
  } else {
    void import("./preview/main");
  }
} else if (
  import.meta.env.DEV &&
  isLocalIntegration({
    development: import.meta.env.DEV,
    enabled: import.meta.env.VITE_PORTAL_INTEGRATION,
    hostname: location.hostname,
    pathname: location.pathname,
  })
) {
  if (/^\/app\/integration\/unified(?:\/|$)/.test(location.pathname)) {
    void import("./integration/unified/main");
  } else {
    void import("./integration/main");
  }
} else if (isReviewRoute(location.pathname)) {
  void import("./review/main");
} else if (
  import.meta.env.DEV && location.pathname === "/app/" &&
  (normalInstallClient(import.meta.env.DEV, import.meta.env.VITE_NEWMAC_WEB_INSTALL_TEST, location.hostname,
    import.meta.env.VITE_NEWMAC_CATALOG_INSTALL_TEST) || catalogInstallTestEnabled(import.meta.env.DEV,
    import.meta.env.VITE_NEWMAC_CATALOG_INSTALL_TEST, location.hostname, import.meta.env.VITE_NEWMAC_WEB_INSTALL_TEST))
) {
  void import("./unified-main");
} else if (
  !import.meta.env.DEV &&
  import.meta.env.VITE_PORTAL_UNIFIED_ENABLED === "1" &&
  portalSurface(location.pathname, isFeatureEnabled(import.meta.env.VITE_SKILLGROUPS_WEB_ENABLED)) === "dashboard"
) {
  void import("./unified-main");
} else if (
  import.meta.env.VITE_PORTAL_REDESIGN_ENABLED === "1" &&
  portalSurface(location.pathname, isFeatureEnabled(import.meta.env.VITE_SKILLGROUPS_WEB_ENABLED)) === "dashboard"
) {
  void import("./redesign-main");
} else {
  void import("./main");
}
