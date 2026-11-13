---
name: spark
description: Create, develop, build, package, diagnose, or upgrade a Legend Spark native desktop app using its installed CLI and tested dependency pins.
---

# Spark apps

Spark adds native macOS/Windows capabilities and desktop build orchestration to React Native and Expo Desktop. This skill covers desktop development. Universal starters also declare mobile/web targets, but Expo owns their runtime and distribution workflows. Do not assume every desktop API works on mobile/web. Windows currently supports development builds; production packaging and native acceptance remain pending. macOS ARM64 is the published preview target; Intel acceptance is pending.

## Using Spark's APIs

Before writing code against a `@legendapp/spark/*` import, read the reference for that area:

| Task | Read |
| --- | --- |
| Open, show, focus or close windows; close guards; macOS title bar/toolbar | [windows.md](windows.md) |
| Quit/relaunch, single instance, opening files and URLs, recent documents | [app-and-documents.md](app-and-documents.md) |
| App menu, context menu, tray / menu-bar item, Dock or taskbar menu | [menus-tray-dock.md](menus-tray-dock.md) |
| Keyboard shortcuts, commands, global hotkeys | [keyboard.md](keyboard.md) |
| Reading/writing files, where app data goes, open/save panels, drag and drop | [files.md](files.md) |
| Preferences, secure storage, SQLite, settings window | [storage-settings.md](storage-settings.md) |
| Notifications, clipboard, badges/power/system info, app updates, child processes, auth, audio | [integrations.md](integrations.md) |
| Native controls, macOS sidebar/search/glass views, WebView, Markdown/HTML | [ui.md](ui.md) |
| Third-party libraries (camera, images, storage…), Spark errors and availability | [library-compat.md](library-compat.md) |
| Running Claude/Codex CLIs, in-app customization | [ai-customize.md](ai-customize.md) |

macOS is the shipped target; Windows is development-only; Spark's desktop APIs do not cover mobile/web beyond the Expo-shaped adapters.

## Create and develop

- Require Node 24.19.0 or newer. Create with `npm create @legendapp/spark@next MyApp` (stable releases use `@latest`). Names must be alphanumeric. `npx @legendapp/create-spark@next MyApp` is equivalent; an installed CLI also supports `spark create MyApp`.
- Creator options follow npm's separator: `npm create @legendapp/spark@next MyApp -- --platform windows --package-manager pnpm`. npm, pnpm, Yarn, and Bun are supported. Keep the app's chosen manager and lockfile.
- In the app, use its installed CLI through scripts: `npm run dev`, `npm run build`, `npm run package`, or the equivalent manager command. For other commands use `npx --no-install spark <command>` with npm, `pnpm exec spark <command>`, `yarn spark <command>`, or `bun run spark <command>`.
- `spark dev` starts Expo's terminal and Metro. A compatible Spark Runner needs no native compilation and downloads on first published macOS launch. `d` opens desktop, `g` switches Runner/custom build, `b` builds and opens a custom development runtime. Expo owns reload (`r`), debugger (`j`), dev menu (`m`), editor (`o`), and mobile/web keys. Ctrl+C stops the session and its native app.
- `spark dev --no-open` waits for a launch key. Expo start flags pass through. `spark dev --go` selects mobile Expo Go, not Spark Runner.

## Configuration and native modules

Edit `desktop.config.json` when present; single-target starters generate `app.json` from it. Universal starters use a managed `app.config.js`. Existing Expo apps can use `spark add desktop`; preserve their Expo entry point and compose configuration as the integration guide requires.

Install native dependencies with the app's manager and use their documented imports. JavaScript changes Fast Refresh; native code, native configuration, or plugins require a custom build. Press `b`, or run `spark build --dev` then `spark dev`. Use `--force` only when regeneration/compilation must be forced. Put durable native changes in packages/config plugins, not disposable generated native projects.

`spark analyze` reports native production selection in `.spark/selection-report.json`. Only SDK modules are pruned automatically; unknown third-party native dependencies stay included. Use package names in `expo.extra.spark.include` for native-only requirements; custom native configuration can require a custom runtime even without extra modules.

## Prepare, build and package

`spark prebuild --platform macos [--project <directory>]` generates the native
macOS project and installs Pods using the development native selection. It shares
build's lock, migration preflight, config plugins, cache recovery, and provenance.
Missing/stale Pods are repaired even with a cached app; a second unchanged run
skips generation and pod install. It runs no xcodebuild, app signing/packaging, or
Metro, installs no JS dependencies, and changes no pins. Pod prepare commands can
compile dependency artifacts. Build flags such as `--dev` and `--force` are rejected.
Follow pending-migration guidance; never stamp `.spark/version` to bypass it.

`spark build` creates a standalone macOS `.app` with bundled JavaScript; `spark open` opens the last standalone build. `spark build --dev` creates the custom Debug runtime. `spark build --preview` uses production module selection in Debug.

Native macOS builds need full Xcode (license/first-launch setup and selected developer directory) and CocoaPods on PATH. Command Line Tools alone are insufficient. `spark package` prepares signing/notarization credentials on first use, then signs, notarizes, and creates the distribution archive. Follow the packaging guide for credentials, CI, and pending submissions. Windows uses `spark dev` and `spark build --dev`; do not promise Windows production output.

## Diagnose and upgrade

- Run `spark doctor` for dependency pins and native tooling; it exits 1 on issues.
- Direct `react`, `react-native`, `expo`, and (for macOS apps) `react-native-macos` specs must match the installed CLI's exact template pins. Ranges are drift even when they include the expected version. Check npm/Bun `overrides`, Yarn `resolutions`, and `pnpm.overrides` too. Do not upgrade React/Expo independently of Spark's tested matrix.
- `catalog:` and `workspace:` baseline specs are left to their owner; validate their resolved versions yourself. Only the app manifest is checked, not workspace-root overrides. Workspace-managed Spark versions need updating at their owner.
- `spark upgrade --dry-run` previews the newest release on the installed version's channel (`next` or `latest`), target pins, install command, and migrations without modifying the app. `spark upgrade` updates Spark and its release inputs, runs the detected manager's install, then applies versioned migrations and refreshes the AI pointers. Both support `--project <directory>`.
- `spark patch <lib>` then `spark patch <lib> --done` saves an app patch layered on Spark's; see [library-compat.md](library-compat.md#patch-a-library).
- `.spark/version` records successful migrations. `dev`, `build`, `prebuild`, and `doctor` apply safe idempotent migrations after a manual version change; unsafe pending changes or downgrades stop with `run spark upgrade`. Lifecycle scripts are not required for this check.
- Keep the generated Spark sections in `AGENTS.md` / `CLAUDE.md` and the `.claude/skills/spark/SKILL.md` pointer thin. Instructions live in this installed package, so updating Spark updates the skill.

## Upgrade an app

Read [the packaged upgrade guide](UPGRADING.md). Before updating, retain the old `.spark/version` (or installed package version if unrecorded). Run `spark upgrade --dry-run` through the app's installed CLI, read the dependency pins, install command, ordered migrations, planned file edits and every manual step, then run `spark upgrade`.

After installation, read this skill and `UPGRADING.md` from the **new installed package**. Read every release note with `old < version <= new`, including intermediate previews; `.spark/version` advancing does not mean app source or custom native modules have passed validation. Work through `.spark/upgrade-notes.md`, apply the notes' API/config/native changes, and mark each reviewed item complete. Rerun the dry run and doctor, typecheck/test the app, then rebuild and exercise affected native flows. Keep the notes until all manual steps are resolved. If installation fails, fix its error and rerun upgrade; earlier file edits can remain, and migrations are idempotent.

## Common failures

- Missing/stale Runner or extra native modules: follow the terminal's compatibility message; build a custom runtime with `b` or `spark build --dev`. A local SDK without release metadata needs a registered local Runner.
- Expo Desktop config import failures: check the actual Node on PATH; Node 24.12.0 is incompatible with this pinned Expo Desktop setup. Use Node 24.19.0 or newer.
- Missing `pod` / `xcodebuild`: install the documented native prerequisites, then retry. Spark does not install Xcode or accept licenses.
- Pin drift, stale Expo terminal patch, or pending migrations: inspect `spark doctor`, preview `spark upgrade --dry-run`, then upgrade. If install fails, fix the manager error and rerun upgrade; the migration version is not advanced by a failed install.
- Malformed `spark:skill` markers: repair the paired marked section without removing user instructions, then rerun upgrade.
- Build details live in `.spark/logs/` and `.spark/commands.jsonl`. Keep `.spark/` (except `.spark/version`), generated native outputs, and dependency directories out of version control; commit source/configuration, AI pointer files, vendored release inputs, and the manager lockfile.

See the maintained [development guide](https://github.com/LegendApp/legend-spark/blob/main/docs/development.md), [packaging guide](https://github.com/LegendApp/legend-spark/blob/main/docs/packaging.md), and [Expo integration guide](https://github.com/LegendApp/legend-spark/blob/main/docs/add-desktop.md). Use the installed CLI's `--help` and templates for version-specific behavior.
