import { isLocalPreview } from "./app/preview-gate";
import { isLocalIntegration } from "./integration/gate";
import { isFeatureEnabled, portalSurface } from "./feature-flags";
import { isReviewRoute } from "./app/routes";

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
  void import("./preview/main");
} else if (
  import.meta.env.DEV &&
  isLocalIntegration({
    development: import.meta.env.DEV,
    enabled: import.meta.env.VITE_PORTAL_INTEGRATION,
    hostname: location.hostname,
    pathname: location.pathname,
  })
) {
  void import("./integration/main");
} else if (isReviewRoute(location.pathname)) {
  void import("./review/main");
} else if (
  import.meta.env.VITE_PORTAL_REDESIGN_ENABLED === "1" &&
  portalSurface(location.pathname, isFeatureEnabled(import.meta.env.VITE_SKILLGROUPS_WEB_ENABLED)) === "dashboard"
) {
  void import("./redesign-main");
} else {
  void import("./main");
}
