import { useState } from "react";
import { Check, ChevronDown, Copy } from "lucide-react";
import { SETUP_PROMPT, isMacBrowser } from "./setup-prompt";

/** Second way to get the Mac app: one button that copies a prompt for Claude Code or Codex. Mac only. */
export function AgentSetupPrompt() {
  const [mac] = useState(() => typeof navigator !== "undefined" && isMacBrowser(navigator));
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const [shown, setShown] = useState(false);
  if (!mac) return null;
  const copy = () => {
    const done = (state: "copied" | "failed") => {
      setCopied(state);
      if (state === "failed") setShown(true);
      window.setTimeout(() => setCopied("idle"), 2500);
    };
    if (!navigator.clipboard) { done("failed"); return; }
    navigator.clipboard.writeText(SETUP_PROMPT).then(() => done("copied"), () => done("failed"));
  };
  return <div className="ua-agent-setup">
    <button type="button" className="ua-install-now ua-install-secondary" onClick={copy} data-humblytics="App Setup Prompt Copy" aria-live="polite"
      title="Paste into Claude Code or Codex. It installs the app and asks before connecting anything.">
      {copied === "copied" ? <><Check /> Copied</> : copied === "failed" ? <>Select it below, then ⌘C</> : <><Copy /> Copy install prompt</>}
    </button>
    <button type="button" className="ua-link ua-agent-setup-toggle" aria-expanded={shown} onClick={() => setShown(open => !open)}>
      {shown ? "Hide prompt" : "Show prompt"} <ChevronDown aria-hidden="true" data-open={shown || undefined} />
    </button>
    {shown && <>
      <pre>{SETUP_PROMPT}</pre>
      <a className="ua-agent-setup-source" href="https://omgskills.com/install.sh" target="_blank" rel="noreferrer">See what it runs</a>
    </>}
  </div>;
}
