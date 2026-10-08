import "./loading.css";

export function LoadingScreen() {
  return <div className="portal-loading" role="status" aria-label="Loading omgskills">
    <span className="portal-loading-spinner" aria-hidden="true" />
  </div>;
}
