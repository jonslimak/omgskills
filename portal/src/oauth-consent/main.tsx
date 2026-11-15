import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ClerkProvider } from "@clerk/react";
import { OAuthConsentPage } from "./OAuthConsentPage";
import "../styles.css";

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
createRoot(document.getElementById("root")!).render(<StrictMode>
  {!publishableKey ? <main><h1>Sign-in unavailable</h1><p>Missing sign-in configuration.</p></main>
    : <ClerkProvider publishableKey={publishableKey}><OAuthConsentPage /></ClerkProvider>}
</StrictMode>);
