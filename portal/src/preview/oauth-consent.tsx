import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { consentRequest, OAuthConsentContent } from "../oauth-consent/OAuthConsentPage";
import "../styles.css";

// Local design preview only (bootstrap gates it to dev on localhost): the consent page with sample data.
const request = consentRequest("?client_id=sample&redirect_uri=http%3A%2F%2F127.0.0.1%3A1455%2Fcallback&scope=profile+email&state=s");
createRoot(document.getElementById("root")!).render(<StrictMode>
  <OAuthConsentContent request={request} view={{ state: "ready", action: "#", data: { oauthApplicationName: "Codex",
    redirectDomain: "127.0.0.1", scopes: [{ scope: "profile", description: "Your name and picture" }, { scope: "email", description: "Your email address" }] } }} />
</StrictMode>);
