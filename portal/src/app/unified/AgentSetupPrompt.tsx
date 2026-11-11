import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { SETUP_PROMPT, isMacBrowser } from "./setup-prompt";

/** Second way to get the Mac app: a prompt for Claude Code or Codex. Mac only. */
export function AgentSetupPrompt() {
  const [mac] = useState(() => typeof navigator !== "undefined" && isMacBrowser(navigator));
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  if (!mac) return null;
  const copy = () => {
    const done = (state: "copied" | "failed") => { setCopied(state); window.setTimeout(() => setCopied("idle"), 2500); };
    if (!navigator.clipboard) { done("failed"); return; }
    navigator.clipboard.writeText(SETUP_PROMPT).then(() => done("copied"), () => done("failed"));
  };
  return <div className="ua-agent-setup">
    <h5>Or set up with your agent</h5>
    <p>Paste this into Claude Code or Codex. Your agent installs the Mac app and asks before connecting anything.</p>
    <pre>{SETUP_PROMPT}</pre>
    <div className="ua-agent-setup-row">
      <button type="button" className="ua-f1-install" onClick={copy} data-humblytics="App Setup Prompt Copy" aria-live="polite">
        {copied === "copied" ? <><Check /> Copied</> : copied === "failed" ? <>Select the text and press ⌘C</> : <><Copy /> Copy prompt</>}
      </button>
      <a href="https://omgskills.com/install.sh" target="_blank" rel="noreferrer">See what it runs</a>
    </div>
  </div>;
}
