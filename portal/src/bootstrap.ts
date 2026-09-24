import { isLocalPreview } from "./app/preview-gate";
import { isLocalIntegration } from "./integration/gate";

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
} else {
  void import("./main");
}
