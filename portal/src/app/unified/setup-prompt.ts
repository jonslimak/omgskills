// "Set up with your agent" (setup-prompt.md). Same text as site/setup-prompt.js (checked by tests).
export const SETUP_PROMPT = "Install the omgskills Mac app for me.\n"
  + "1. First tell me in one line what it does: installs the omgskills app in Applications (an older copy goes to the Trash), nothing else.\n"
  + "2. Then run: curl -fsSL https://omgskills.com/install.sh | bash\n"
  + "3. When it opens, I'll sign in.\n"
  + "4. Then ask me if you should connect My skills (https://omgskills.com/my/mcp) to you. Don't connect anything unless I say yes.";

/** A Mac (not an iPad asking for the desktop site). */
export function isMacBrowser(nav: Pick<Navigator, "platform" | "maxTouchPoints"> & { userAgentData?: { platform?: string } } = navigator) {
  const platform = nav.userAgentData?.platform || nav.platform || "";
  return /mac/i.test(platform) && !(nav.maxTouchPoints > 1);
}
