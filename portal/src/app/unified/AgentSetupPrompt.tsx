import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { SETUP_PROMPT, isMacBrowser } from "./setup-prompt";

/** Second way to get the Mac app: a prompt for Claude Code or Codex. Mac only. */
export function AgentSetupPrompt() {
  const [mac] = useState(() => typeof navigator !== "undefined" && isMacBrowser(navigator));
  const [copied, setCopied] = useState(false);
  if (!mac) return null;
  const copy = () => {
    void navigator.clipboard?.writeText(SETUP_PROMPT).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }, () => undefined);
  };
  return <div className="ua-agent-setup">
    <h5>Or set up with your agent</h5>
    <p>Paste this into Claude Code or Codex. Your agent installs the Mac app and asks before connecting anything.</p>
    <pre>{SETUP_PROMPT}</pre>
    <div className="ua-agent-setup-row">
      <button type="button" className="ua-f1-install" onClick={copy} data-humblytics="App Setup Prompt Copy">
        {copied ? <><Check /> Copied</> : <><Copy /> Copy prompt</>}
      </button>
      <a href="/install.sh" target="_blank" rel="noreferrer">See what it runs</a>
    </div>
  </div>;
}
