# Add desktop to an existing Expo app

`spark add desktop` integrates the spark host and development commands into an installed Expo app. Expo remains the source of application configuration. The app keeps its entry point, screens, mobile/web scripts, and existing native mobile projects.

## Current baseline

This integration uses Expo Desktop **1.0.0**, native template **54.81.1**, React Native macOS **0.88.0-rc.4**, and React Native Windows **0.81.35**. The baseline (read from the universal template) requires installed Expo **58.0.7**, React Native **0.88.0-rc.4**, and React **19.3.0**. The command rejects a different baseline before editing files; upgrading an existing app is a separate change.

Packages are still distributed as local SDK archives. From the framework checkout:

```sh
bun install
bun run spark sdk pack
bun run spark add desktop --project /absolute/path/to/ExistingExpoApp
```

The command uses the app's declared package manager, or its existing lockfile, for installation. Without either it follows the invoking package manager, then prefers npm. Conflicting lockfiles require an explicit `packageManager` field. The integration fixture runs on Node with npm; installation and override formats follow the selected package manager.

In the integrated app:

```sh
# Existing mobile/web commands keep their meaning
npm run ios
npm run android
npm run web

# Build once, then develop on macOS
npx --no-install spark build --dev --platform macos
npm run macos

# On a configured Windows machine
npx --no-install spark build --dev --platform windows
npm run windows
```

If a `macos` or `windows` script already exists, it is preserved and the added script is named `frame:macos` or `frame:windows`. Direct spark commands can also select the target with `--platform`. A compatible registered Spark Runner can be used through the existing development session; the initial native build is only necessary when no compatible binary is available.

For one shared session, run `npx --no-install spark dev --no-open`, then use `i`, `a`, `w`, and `d`. The existing Expo scripts stay unchanged; they remain available for standalone Expo workflows. Standard Expo start options pass through frame.

## Configuration composition

The integration adds `desktop.config.json` with `"extends": "expo"`, stable project identity, desktop options, supported targets, and desktop autolinking exclusions. Names, versions, mobile identifiers, plugins, and environment-dependent application values continue to come from Expo config.

The command composes the existing `app.config.js` or `app.config.ts` export with `withSparkExpo` from `@legendapp/spark/expo-config`. For a static `app.json`, it adds a small `app.config.js` that extends Expo's supplied config. It keeps the original configuration code in the same file and directory, preserving relative imports and environment logic.

Ordinary Expo commands, including commands without `SPARK_PLATFORM`, retain their original configuration. For native builds, `SPARK_PLATFORM=macos` or `windows` applies desktop options and the spark config plugin. A `spark dev` session instead exposes all declared platforms, preserves the original shared Expo config and plugins, and omits desktop build overlays. spark commands supply that environment automatically. For direct Expo Desktop commands, set it explicitly:

```sh
SPARK_PLATFORM=macos npx expo config
```

PowerShell uses `$env:SPARK_PLATFORM="windows"`. Keep desktop-specific exclusions and options in `desktop.config.json`; keep mobile/web configuration in the existing Expo files. Previously generated iOS and Android projects stay in place. Native generation/build operations against one checkout must run sequentially.

## Metro and native configuration

The existing Metro config gets its defaults through `@legendapp/spark/metro`. That helper delegates to Expo for standalone mobile/web commands and Expo Desktop for desktop or shared spark dev sessions. Application customizations continue to run after those defaults. Custom resolver fallbacks retain upstream desktop module resolution, and spark adds its development compatibility gate.

Desktop hosts request `index.bundle` or `index.windows.bundle`. The composed Metro config routes those requests through Expo's virtual entry resolver, which reads the original `package.json` main. There is no generated replacement application entry. Apps must register the normal Expo `main` component through their existing entry.

The existing React Native config export is composed with `withSparkNative`. Mobile commands retain the original object; desktop commands add platform discovery and native selection while preserving application assets and configuration.

## Boundaries and failure handling

- Automatic export composition supports CommonJS `module.exports` and `export default` expressions in Expo config, including TypeScript. Re-exported defaults and default function declarations need explicit composition. Metro and React Native automatic composition currently target `.js` config files; other file formats and projects declaring `type: "module"` require explicit integration.
- Metro must use Expo's `getDefaultConfig`. Unsupported shapes, occupied script names, conflicting dependency pins, and existing desktop native projects are rejected before file writes. Existing macOS/Windows projects need host composition rather than being overwritten.
- Once preflight passes, changes remain reviewable if package installation fails. Fix the install error and rerun the command; repeated integration installs dependencies without rewriting configuration or changing project identity.
- Adding desktop does not port mobile-only dependencies. The initial exclusions cover the known mobile-only backends already handled by the universal starter. Additional native packages/plugins may require desktop implementations or desktop-specific exclusions.
- Keeping an entry point such as `expo-router/entry` does not establish desktop Router compatibility. Router integration and secondary JavaScript runtimes remain separate work. The fixture uses a custom Expo entry without Router.
- Windows native acceptance and API parity remain tracked in [known Windows issues](windows-issues.md). This command does not claim Windows release/distribution support.

## Verification

`bun run test:add-desktop` creates an independent Expo app with a custom TypeScript configuration, config plugin, Metro alias, React Native config, and `src/bootstrap.ts` entry. It verifies the app's original mobile bundle, generates its iOS project before integration, and then checks:

- Rejection of an unsupported Metro configuration before any integration files are written.
- Unchanged mobile/web config and plugin behavior, app source, entry point, existing scripts, and repeated-integration identity.
- All five bundles using the original entry and custom resolver, plus desktop host request rewriting.
- Windows generation without changing the existing iOS project or shared app files.

Workspace unit tests separately check export composition and mobile no-op behavior. Native compilation and execution are recorded separately from generation and bundle checks.

## Recorded validation — 2026-09-13

- Workspace TypeScript and 134 unit tests passed (580 assertions).
- The independent dynamic-config fixture passed its original mobile bundle, all five post-integration bundles, custom resolver and desktop request routing, config/plugin preservation, conflict rejection, and repeated integration checks.
- Windows generation preserved the previously generated iOS project and shared files. Equivalent project paths produced identical spark configuration, excluding Expo's diagnostic `_internal` metadata from compatibility inputs.
- A static `app.json` fixture with no explicit `main` retained its app/config source and bundled on macOS through Expo's default AppEntry.
- The adopted app compiled on macOS and mounted through the normal spark development session. A temporary mount callback confirmed its custom entry/Metro alias and Hermes execution; the diagnostic source edit was restored afterward.

Execution used the synchronized `/tmp/spark-api-clean` checkout because Bun stalls in Documents on this host. Windows native execution, arbitrary third-party native libraries/Router, and the other package managers remain outside this acceptance record.
