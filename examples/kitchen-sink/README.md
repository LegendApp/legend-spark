# Kitchen Sink

A checked-in desktop app using the framework's workspace packages, Expo Desktop
beta, native UI controls, and Uniwind. It runs directly from this directory.

```sh
cd examples/kitchen-sink
bun install
bun run macos
# On Windows:
bun run windows
```

Bun installs the workspace dependencies and applies the checked-in desktop library
adapters. It does not create another application, pack the SDK, or compile native
code. The repository lockfile is shared by the app and framework packages.

The run commands open Expo's development terminal and the app's custom
development runtime (see below). Edit the screens, framework JavaScript, or CSS for
Fast Refresh. The theme defaults to System; the header button cycles through
System, Light, and Dark. Native changes invalidate the old runtime and require an
explicit rebuild.

## Screens, deep links and test IDs

The app opens a catalog of the release-gate areas (one per epic, listed in
`shell/areas.ts`). Each area owns one folder and registers its screens in
`screens/<area>/index.tsx`; the catalog discovers these files, so adding screens
never edits a shared file:

```tsx
// screens/windows/index.tsx
import { defineScreens } from "../../shell/registry";
import { FrameAutosave } from "./FrameAutosave";

export default defineScreens("windows", [
  { id: "frame-autosave", title: "Frame autosave", summary: "Restores each window's frame.", component: FrameAutosave },
]);
```

Screen ids are lowercase kebab-case. Every screen opens from
`spark-ks://<area>/<screen>`, an area's screen list from `spark-ks://<area>`, and
the catalog from `spark-ks://`. Links to unknown areas or screens show a
“No such screen” page instead of silently opening the catalog.

Deep links need the URL scheme registered with the OS, which a custom runtime
does (see below). From a terminal:

```sh
open "spark-ks://infra/desktop-checks"                 # macOS
start "" "spark-ks://infra/desktop-checks"             # Windows (cmd)
```

Test IDs (the macOS AX identifier and Windows UIA AutomationId) are
`<area>-<screen>-<element>`, all lowercase kebab-case, for example
`windows-frame-autosave-reset-button`. The registry renders every screen inside
a root view with testID `<area>-<screen>-root`; screens cannot omit or rename it,
and test drivers wait for it to confirm a navigated screen has rendered. The
shell's own elements use area `infra` and screen `shell`: `infra-shell-root`,
`infra-shell-sidebar`, `infra-shell-catalog`, `infra-shell-area-<area>`,
`infra-shell-screen-<area>-<screen>`, `infra-shell-breadcrumb`,
`infra-shell-theme-toggle`, `infra-shell-home`, `infra-shell-not-found`
(`-url`, `-reason`), `infra-shell-error` and, before the locale is read,
`infra-shell-starting`.

Screens ported from legend-apps' `apps/test-kitchen-sink` live in their areas and
use only public `@legendapp/spark` entry points: `native-controls` (sidebar ×3,
split view, glass, SF Symbols, search field), `keyboard` (keyboard monitor),
`windows` (window manager, including the macOS-only `/windows/macos` blur, and
window controls) and `future-facing-capabilities` (AI command and tool runners).
They share `Panel.tsx`.

`multiwindow/windows` exercises `createWindowsNavigator` from `/windows`: note windows
(one per open), a single Settings window, a document shared live across windows,
per-window stars with promotion (`createWindowState`), per-window undo and menus, an
error-isolation window and an isolated-runtime window.

## App-wide behavior

`shell/app-controller.ts` starts once from `index.ts` and lives for the process:
the Document menu (Open…/Save…), ⌘⇧K, the unsaved-changes prompt on quit and on
closing the main window, and `spark-ks://` routing. It holds the document the
Desktop checks screen edits, so these work from any screen. Native-test report
launches (`--spark-*-report`, see `launch.ts`) install none of it.

## Languages and right-to-left layout

The shell, the Document menu and the unsaved-changes prompt are localized in
`shell/i18n.ts` (English and Arabic). The locale comes from the system
(`getSystemInfo().locale`); other languages use English. Arabic lays the shell out
right to left, including the breadcrumb separator. Screen titles, summaries and
contents belong to each area. On macOS the app declares `en` and `ar`
localizations, so it follows the system language or a launch override such as
`-AppleLanguages "(ar)" -AppleLocale ar_EG`.

## Screenshots for verification

Agents capture the real app in-process, without showing a window or taking focus:

```sh
(cd examples/kitchen-sink && bun run rebuild:macos)   # once, and after native changes
bun run ks:capture <area>/<screen> --appearance dark --out e2e/verification/<N>/
```

See [the in-app test driver](../../docs/test-driver.md) for options and what a capture contains.

## Install or rebuild the native runtime

JavaScript dependencies do not include a native executable. The `spark-ks://`
URL scheme and the macOS localizations need an app-specific runtime, so the
shared Spark Runner cannot serve this app. Build one **once** with the platform's
native toolchain installed, and again after native changes:

```sh
bun run rebuild:macos
# On Windows (including ARM64 Parallels):
bun run rebuild:windows
```

These run `spark build --dev`, which compiles a Debug runtime containing this
app's native dependencies and remembers it for the next session. Subsequent
`bun run macos` / `bun run windows` starts Metro and opens that runtime. Use
`--no-open` to start only the development terminal, or `--port 8082` to choose a
port. A stale runtime stays gated until you explicitly rebuild; startup never
silently compiles. See [Windows setup and acceptance](../../docs/windows-slice.md).

The application identity and configuration live in `desktop.config.json`. Switching
platforms preserves them. Generated native projects and `.spark` state stay local
and ignored by Git. The example currently exercises desktop-only APIs; the separate
Settings example demonstrates mobile/web sharing.

## Release build

The release build uses the same commands as shipping apps:

```sh
bun run build     # spark build: Release, Hermes, embedded JavaScript bundle, ad-hoc signed
bun run package   # spark package: Developer ID signing and notarization
```

`spark build` compiles the Release configuration, embeds `main.jsbundle` (it fails
without one), so the app never contacts Metro, and ad-hoc signs the result under
`.spark/products/`. `spark package` signs a staging copy with the Developer ID
identity chosen by `spark credentials` or the `SPARK_DEVELOPER_ID_APPLICATION` /
`SPARK_TEAM_ID` variables, then notarizes it; see
[packaging](../../docs/packaging.md). The CLI does not yet produce Windows
release builds.

Known limitation: in this workspace checkout `bun run build` fails. The production
analysis matches native packages by absolute or `node_modules/<name>/` source paths,
but Metro reports workspace packages as `/packages/<name>/…`, so the Spark modules
are excluded, their codegen is skipped, and `RNSparkUI` stops compiling on a
missing `RNSparkUISpec` header. The packed consumer (`bun run kitchen-sink:prepare`)
resolves Spark from `node_modules` and is not affected by this path mismatch.

## Framework maintenance and integration tests

From the repository root, `bun run kitchen-sink` is a shortcut for this app's `dev`
script. `bun run kitchen-sink:prepare` deliberately packs the SDK and creates a
separate consumer under `.spark/examples/KitchenSinkPackaged` for integration tests.
It never overwrites this app's manifest, identity, or native projects.

External-library adapter changes use `bun run sync:workspace-patches`, then
`bun run postinstall`. That maintainer command derives the install patches from
the same pinned recipes as SDK packing. It is not part of normal startup.
