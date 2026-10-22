# F1 Manual Test

Test app: **OMGSkills F1 Test.app**, menu-bar label **F1**.
No sign-in. Nothing is installed into your real Codex skills folder.
The regular OMGSkills app is unchanged; do not use it for this test.

## First check: Cancel

1. Open [the local frontend-design detail](http://127.0.0.1:5197/app/preview/unified/?view=discover&skill=catalog%3Aanthropics%2Fskills%3Askills%2Ffrontend-design).
2. Click **Open in OMGSkills F1 Test**. Allow the browser to open that app if asked.
3. Wait for the review, then click **Cancel**, not **Install in test folder**.
4. Tell the agent "cancelled". The agent checks that no skill was installed.

The app should show frontend-design, commit beginning `2235be7`, and a destination
under `/private/tmp/omgskills-f1-hVqS0Y/home/` (macOS may display `/tmp/` instead).
Stop if the wrong app opens or the destination is outside that test home.

## Remaining checks, one at a time

- Reopen A and approve **Install in test folder**. Agent verifies bytes/record and isolated Codex discovery.
- Reopen A: expect **Already installed** and no change to the install record.
- Select **F1: Version B** in the page's test controls; reopen the detail. Review then **Cancel**. Agent verifies A remains.
- Agent introduces one recorded edit to this disposable install; reopening B must refuse it. Agent restores only that edit.
- Reopen B and approve **Apply update in test folder**. Agent verifies exact B bytes/record and isolated Codex discovery.

Close the web skill-details panel to reach the revision selector if it is covered.
Do not refresh after selecting B, since a fresh page defaults to A.
Do not use the sample-account, sign-in or public-download controls.

Receipt: `/private/tmp/omgskills-f1-hVqS0Y/receipt.json`.
Cleanup is a separate step after acceptance: only this named app, test root, F1
registration and local server. No commit, deploy or Sparkle release is part of this test.
