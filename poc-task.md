# omgskills POC — Task Breakdown

Execution doc for building the thin-slice POC defined in `poc.md`. Work top-to-bottom; tasks within the same section can parallelize where noted. Target: ~5 hours total (~3 remaining after scraper).

## 0. Pre-flight

- [x] **GitHub fine-grained PAT** with public read access. Store in `index/.env` as `GITHUB_TOKEN=...`. `.env` is gitignored.
- [x] **Node 20+** (`node -v`).
- [x] **Xcode Command Line Tools** (`xcode-select -p` returns a path). Provides `swift`, `swiftc`, `xcrun`. No Xcode GUI required.
- [x] **macOS 13+** (required for `MenuBarExtra` / modern SwiftUI). `sw_vers` to verify.
- [x] Confirm folder layout plan (see `poc.md` "File layout"): single `omgskills/` with `index/` + `menubar/` siblings.

## 1. Index scaffolding (~20 min) ✓ done

- [x] `index/package.json` with `type: "module"`, scripts: `scrape`, `typecheck`.
- [x] Deps: `@octokit/rest`, `@octokit/plugin-throttling`, `@octokit/plugin-retry`, `yaml`, `dotenv`. Dev: `tsx`, `typescript`, `@types/node`.
- [x] `index/tsconfig.json` — ES2022, strict, bundler resolution.
- [x] `index/.gitignore` — `node_modules`, `.env`.
- [x] `index/scraper/types.ts` — exports `Skill` interface. Mirrored into Swift as `Skill.swift`.

## 2. GitHub scraper (~2 hrs) ✓ done

- [x] `scraper/client.ts` — throttled + retrying Octokit, loads `GITHUB_TOKEN` from `.env`.
- [x] `scraper/sources/topics.ts` — three topic variants, merged.
- [x] `scraper/sources/code.ts` — `filename:SKILL.md` filtered to root `SKILL.md` or `.claude/skills/*/SKILL.md`.
- [x] `scraper/enrich.ts` — repo meta + SKILL.md + README. Skips repos without valid frontmatter.
- [x] `scraper/build.ts` — merges, stamps `first_seen`, sorts by stars, writes `skills.json`.

**Verified**: `npm run scrape` produces ~1,100+ skills from ~2,400 candidates after filter. Clean data.

## 3. SwiftUI menu-bar app (~3 hrs)

Replaces the previous Raycast extension. `menubar/` is a Swift Package with a `build.sh` that wraps the binary in a `.app` bundle.

### 3a. Scaffold (~30 min)

- [ ] `menubar/Package.swift` — Swift Package declaring executable target `omgskills`, platform `.macOS(.v13)`, deps on `sindresorhus/KeyboardShortcuts`.
- [ ] `menubar/Info.plist` — `LSUIElement=true` (no dock icon), `CFBundleIdentifier=com.jonslimak.omgskills`, `LSMinimumSystemVersion=13.0`.
- [ ] `menubar/build.sh` — `swift build -c release`, then assemble `dist/omgskills.app/Contents/{MacOS,Resources}/`, copy `Info.plist` and `skills.json`.
- [ ] `menubar/Sources/omgskills/Skill.swift` — Codable struct matching `index/scraper/types.ts` field-for-field.
- [ ] `menubar/Sources/omgskills/SkillsStore.swift` — reads `skills.json` from bundle `Resources/`, decodes into `[Skill]`.
- [ ] `menubar/Resources/skills.json` — copied from `../index/skills.json` by `build.sh`.
- [ ] `menubar/Resources/AppIcon.png` — reuse the placeholder from before (file icon, not menu-bar icon).

**Done when**: `./build.sh` produces `dist/omgskills.app`, `open dist/omgskills.app` launches it (but does nothing visible — menu-bar icon comes in 3b).

### 3b. Menu-bar icon + popover (~45 min)

- [ ] `Sources/omgskills/omgskillsApp.swift` — `@main` app using `@NSApplicationDelegateAdaptor`. Minimal `Settings` scene (or `Scene { EmptyScene() }` equivalent) to avoid a main window.
- [ ] `AppDelegate` class:
  - `applicationDidFinishLaunching` creates `NSStatusItem` with SF Symbol `eyes` as a template image.
  - Creates an `NSPopover` (400×500, `.transient` behavior) hosting `ContentView()` via `NSHostingController`.
  - Button action → toggle popover.
- [ ] `activate(ignoringOtherApps: true)` in `applicationDidFinishLaunching` so the popover takes focus when opened.

**Done when**: launching the app puts an `eyes` icon in the menu bar and clicking it opens an empty popover.

### 3c. Search + list (~60 min)

- [ ] `Sources/omgskills/ContentView.swift`:
  - `@StateObject var store = SkillsStore()` (loads once at init).
  - `@State var query = ""`.
  - `@FocusState var searchFocused`.
  - Layout: `VStack` with `TextField("Search…")` at top (autofocus on appear), `List(filtered) { skill in SkillRow(skill: skill) }` below.
  - `filtered`: case-insensitive `contains` over `name + description + tags.joined(" ") + author_handle`. Not fuzzy yet.
  - Arrow-key selection handled by SwiftUI `List` automatically.
- [ ] `SkillRow` view: name (headline), description (subheadline, one-line truncation), trailing `Text("★\(stars)")` + first tag as a `Text` with capsule background.
- [ ] On `ContentView.onAppear`, set `searchFocused = true`.
- [ ] `NotificationCenter` observer for popover-opened event to reset focus + clear query (optional polish).

**Done when**: opening the popover shows the full list, typing filters live, arrow keys move selection.

### 3d. Actions (~30 min)

- [ ] Keyboard shortcuts inside `ContentView` via `.keyboardShortcut`:
  - ⏎ on the selected row → `NSPasteboard.general.clearContents(); NSPasteboard.general.setString(skill.install_cmd, forType: .string); popover.close()`.
  - ⌘⏎ → `NSWorkspace.shared.open(URL(string: skill.github_url)!)`.
  - ⌘. → copy GitHub URL to pasteboard.
  - ESC → `popover.close()`.
- [ ] Bottom toolbar row with 3 buttons ("Copy Install", "Open GitHub", "Copy URL") — for discoverability, same keyboard shortcuts shown.
- [ ] `SkillDetailView.swift` — optional for POC if the row has enough info. If added: `NavigationLink` from row → full description, readme snippet, metadata, same action buttons. Push into the popover's nav stack.

**Done when**: ⏎ on a skill copies a working install command; ⌘⏎ opens GitHub.

### 3e. Global hotkey (~30 min)

- [ ] Add `https://github.com/sindresorhus/KeyboardShortcuts` to `Package.swift` deps.
- [ ] `Sources/omgskills/KeyboardShortcutNames.swift`:
  ```swift
  import KeyboardShortcuts
  extension KeyboardShortcuts.Name {
      static let togglePopover = Self("togglePopover", default: .init(.s, modifiers: [.option, .shift]))
  }
  ```
- [ ] In `AppDelegate.applicationDidFinishLaunching`:
  ```swift
  KeyboardShortcuts.onKeyUp(for: .togglePopover) { [weak self] in
      self?.togglePopover()
  }
  ```

**Done when**: ⌥⇧S toggles the popover from anywhere.

### 3f. Polish (~15 min)

- [ ] Empty state: if `store.skills.isEmpty`, show `ContentUnavailableView("No skills indexed", systemImage: "magnifyingglass", description: Text("Run npm run scrape"))`.
- [ ] Handle missing `readme_snippet` gracefully (Swift's `Optional` via `String?`).
- [ ] Icon in the menu bar should be template-style (monochrome, auto-inverts on dark mode). SF Symbol handles this.
- [ ] `sizeThatFits` or explicit popover content size so the popover renders at its intended 400×500.

**Done when**: `./build.sh` && `open dist/omgskills.app` → menu-bar icon appears → click opens popover with ~1,100 skills → typing filters → ⏎ copies install.

## 4. Wire-up + dogfood prep (~30 min)

- [ ] Run fresh scrape if needed (scraper is already complete).
- [ ] `cd menubar && ./build.sh && open dist/omgskills.app`.
- [ ] Test 5 real queries: `ios`, `design`, `review`, `rails`, `remotion`. Confirm sensible results.
- [ ] Copy install command for one skill, paste into a test Claude Code session, verify install works.
- [ ] Test global hotkey toggles popover from different apps.
- [ ] Create `NOTES.md` in repo root with a running log for the dogfood week.

## 5. Dogfood week (async, 7 days)

Just use it. Keep `NOTES.md` updated so Section 6 has real data.

## 6. Validation writeup (~30 min, end of week)

Answer the four questions from `poc.md` in `NOTES.md`:
1. Coverage rate across ~15 queries.
2. Times you reached for the menu-bar icon vs. a browser.
3. What kind of skill was most often missing.
4. Did you want recommendation data?

Decision gate:
- Coverage low → iterate scraper.
- Coverage fine, usage high → start Phase 2 (Twitter recommendations).
- Usage low → rethink form factor.

## Critical path

```
0 → 1 → 2 ✓ done
             │
             └─► 3a → 3b → 3c → 3d → 3e → 3f → 4 → 5 → 6
```

Sections 3a–3f are sequential; each step depends on the previous for a working test loop.

## File checklist

```
omgskills/
  plan.md                            ✓ exists
  poc.md                             ✓ exists
  poc-task.md                        ✓ exists (this file)
  NOTES.md                           created in section 4
  index/                             ✓ done
    .env
    .gitignore
    package.json
    tsconfig.json
    skills.json                      ✓ scraper output (committed)
    scraper/
      types.ts
      client.ts
      build.ts
      enrich.ts
      sources/
        topics.ts
        code.ts
  menubar/
    Package.swift                    section 3a
    Info.plist                       section 3a
    build.sh                         section 3a
    Sources/omgskills/
      omgskillsApp.swift             section 3b
      ContentView.swift              section 3c
      SkillDetailView.swift          section 3d (optional)
      SkillsStore.swift              section 3a
      Skill.swift                    section 3a
      KeyboardShortcutNames.swift    section 3e
    Resources/
      skills.json                    copied from ../index/skills.json
      AppIcon.png                    reused placeholder
```
