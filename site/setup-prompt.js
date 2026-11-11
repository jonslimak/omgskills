// "Set up with your agent": a second way to get the Mac app, next to Download (setup-prompt.md).
// Pages mark spots with <span data-setup-prompt hidden></span>. Shown only on a Mac.
// The prompt text matches portal/src/app/unified/setup-prompt.ts (checked by tests).
(function () {
  var PROMPT = "Install the omgskills Mac app for me.\n"
    + "1. First tell me in one line what it does: installs the omgskills app in Applications (an older copy goes to the Trash), nothing else.\n"
    + "2. Then run: curl -fsSL https://omgskills.com/install.sh | bash\n"
    + "3. When it opens, I'll sign in.\n"
    + "4. Then ask me if you should connect My skills (https://omgskills.com/my/mcp) to you. Don't connect anything unless I say yes.";

  function isMac() {
    var platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "";
    return /mac/i.test(platform) && !(navigator.maxTouchPoints > 1);
  }
  var spots = document.querySelectorAll("[data-setup-prompt]");
  if (!spots.length || !isMac()) return;

  var style = document.createElement("style");
  style.textContent = ""
    + ".sp-trigger{appearance:none;border:0;background:none;padding:0;margin:0;font:inherit;font-size:12px;color:inherit;opacity:.75;text-decoration:underline;text-underline-offset:3px;cursor:pointer}"
    + ".sp-trigger:hover{opacity:1}"
    + ".sp-dialog{width:min(520px,calc(100vw - 32px));border:1px solid #e4e4e7;border-radius:20px;padding:24px;color:#1d1d1f;background:#fff;box-shadow:0 24px 60px rgba(0,0,0,.18);font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;line-height:1.5;text-align:left}"
    + ".sp-dialog::backdrop{background:rgba(0,0,0,.35)}"
    + ".sp-dialog h2{margin:0 0 6px;font-size:20px;letter-spacing:-.01em}"
    + ".sp-dialog p{margin:0 0 14px;color:#6e7380;font-size:14px}"
    + ".sp-dialog pre{margin:0 0 14px;padding:14px 16px;border-radius:12px;background:#f4f4f7;white-space:pre-wrap;word-break:break-word;font:12.5px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;color:#1d1d1f}"
    + ".sp-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}"
    + ".sp-copy{appearance:none;border:0;border-radius:999px;background:#007aff;color:#fff;font:inherit;font-size:14px;font-weight:500;height:40px;padding:0 18px;cursor:pointer}"
    + ".sp-copy:hover{opacity:.85}"
    + ".sp-close{appearance:none;border:1px solid #e4e4e7;border-radius:999px;background:#fff;color:#1d1d1f;font:inherit;font-size:14px;height:40px;padding:0 16px;cursor:pointer}"
    + ".sp-dialog small{display:block;margin-top:14px;color:#6e7380;font-size:12px}"
    + ".sp-dialog small a{color:inherit}"
    + "[data-setup-prompt][hidden]{display:none!important}";
  document.head.appendChild(style);

  var dialog = document.createElement("dialog");
  dialog.className = "sp-dialog";
  dialog.setAttribute("aria-labelledby", "sp-title");
  dialog.innerHTML = '<h2 id="sp-title">Set up with your agent</h2>'
    + "<p>Paste this into Claude Code or Codex. Your agent installs the Mac app and asks before connecting anything.</p>"
    + "<pre></pre>"
    + '<div class="sp-row"><button type="button" class="sp-copy" data-humblytics="Setup Prompt Copy" aria-live="polite">Copy prompt</button>'
    + '<button type="button" class="sp-close">Close</button></div>'
    + '<small>Apple silicon, macOS 14+. <a href="https://omgskills.com/install.sh" target="_blank" rel="noopener">See what it runs</a> · <a href="/download">Download instead</a></small>';
  dialog.querySelector("pre").textContent = PROMPT;
  document.body.appendChild(dialog);

  var copy = dialog.querySelector(".sp-copy");
  copy.addEventListener("click", function () {
    var done = function () { copy.textContent = "Copied"; setTimeout(function () { copy.textContent = "Copy prompt"; }, 2000); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(PROMPT).then(done, function () { select(); });
    else select();
  });
  function select() {
    var range = document.createRange(); range.selectNodeContents(dialog.querySelector("pre"));
    var selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    copy.textContent = "Press ⌘C to copy";
  }
  dialog.querySelector(".sp-close").addEventListener("click", function () { dialog.close(); });
  dialog.addEventListener("click", function (event) {
    if (event.target !== dialog) return;
    var box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
  });

  spots.forEach(function (spot) {
    var trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "sp-trigger";
    trigger.textContent = spot.getAttribute("data-label") || "or set up with your agent";
    trigger.setAttribute("data-humblytics", "Setup Prompt Open");
    trigger.setAttribute("aria-haspopup", "dialog");
    trigger.addEventListener("click", function () { dialog.showModal(); });
    spot.appendChild(trigger);
    spot.hidden = false;
  });
})();
