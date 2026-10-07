# Developing the local prototype

## Create and develop an app

With the local SDK packed and a Spark Runner registered, run from the framework checkout:

```sh
bun run spark create /tmp/MySparkApp
cd /tmp/MySparkApp
npm run macos
```

`npm run macos`, `npm start`, and `npm run dev` run Expo CLI's development terminal with spark desktop actions. Existing apps can use `"macos": "spark dev"` and `"start": "spark dev"`; the small spark supervisor starts the installed `expo start` with inherited terminal input/output. Expo owns Metro, prompts, reload, debugging, logs, and its mobile/web keys.

`create` delegates template extraction, identity assignment, and installation to Expo Desktop. `dev` discovers a compatible registered Spark Runner, uses Expo's host and port selection, and opens the app after Expo is ready. Running a compatible Spark Runner invokes no native build tools. Use `--no-open` to wait for a desktop launch key instead.

Expo's command table adds:

```text
› Press d │ open macOS (Spark Runner)
› Press g │ switch desktop to development build
› Press b │ build and open macOS development build
```

On Windows, the actions target Windows. They are disabled when the target cannot run on the host. `g` switches between the Spark Runner and a custom development build; it never compiles automatically. `b` becomes available when a custom build is required. Switching binaries can reset React state. Selection is remembered in `.spark/settings.json`.

Expo retains `r` for reload, `j` for debugging, `m` for the dev menu, `w` for web, `o` for your editor, and `s` for the **mobile** Expo Go/development-client switch. `?` shows the current command table. **Ctrl+C** exits Expo and closes the native app owned by this session. Metro output appears directly in the terminal; native build logs remain in `.spark/logs/`.

The extension uses a process-local patch to `@expo/cli@54.0.27`, verified against the exact upstream source before startup. It does not modify installed Expo files or affect ordinary `expo start` calls. See [Expo Desktop integration](expo-desktop-integration.md#expo-development-terminal-patch) for patch maintenance.

A universal project's single dev session serves iOS, Android, web, macOS, and Windows. Use Expo's `i`, `a`, and `w` keys alongside spark's `d`. `--platform ios` requests an initial iOS launch while keeping the host desktop keys. LAN is Expo's default, so a phone and the local desktop app can use the same server. The declared `platforms` list controls availability; dev does not add platform support to a desktop-only application.

Native signatures and prebuilt compatibility remain desktop-specific. A missing or stale desktop runtime blocks only that desktop's bundle requests; mobile and web continue serving and receiving Fast Refresh. Native build/prebuild commands still select one target and preserve the other generated projects. A config/dependency change can restart the shared server even while desktop is incompatible.

The normal production command is:

```sh
npm run build
```

It produces a standalone `.app` and prints its location. `spark open` opens the last standalone product without requiring its path.

macOS builds print cache-miss reasons, stream generation/Pods/Xcode output, and
report each phase's log path and elapsed time. Each mode's build receipt records
the native contents, configuration, and package locations used to build its app.
An unchanged cached dev app can be reused after a release build, even when that
build changed the shared generated project. Older receipts rebuild once to record
this provenance. When compilation is needed, missing CocoaPods XCFramework inputs
trigger a pod reinstall and must be restored before Xcode starts.
Codegen and podspec edits refresh Pods without regenerating the native project.
Configuration, host, package metadata, and package location changes regenerate
the project while preserving installed Pods, the lockfile, and Hermes downloads.
Xcode's separate DerivedData cache is retained in both cases.

macOS releases target ARM64 and enable dead-code stripping, ThinLTO, and `-Oz`
for the app and source-built Pods. Release postprocessing strips distribution
symbols; prebuilt Hermes symbols are stripped separately before ad-hoc signing.
The compiler settings participate in the release cache fingerprint, so changing
them rebuilds existing products. Debug-based prebuilt, dev, and preview modes
and Windows builds are unaffected.

To prepare a signed, notarized distribution archive, run `npm run package` in a new starter, or `npx --no-install spark package` in an existing app. First use discovers signing identities and configures a notarization Keychain profile. See [packaging](packaging.md) for setup, CI, and retry behavior.

## Prepare the local SDK (framework maintainers)

This setup is done once per local SDK, rather than for every app:

```sh
bun install
bun run spark sdk pack
bun run spark sdk build-runner
```

`pack` produces local package archives and registers their manifest. `build-runner` creates a managed SDK starter, installs the packed SDK, builds the Spark Runner, and registers the result automatically. Repeating it refreshes local packages before checking whether the binary needs rebuilding. To build from an existing SDK starter, pass `--project /path/to/starter`.

An existing prebuilt binary can be registered without rebuilding:

```sh
bun run spark sdk register /path/to/SparkRunner.app
```

Packing also discovers the saved prototype binary at `artifacts/runtimes/SparkRunner.app`, if present. Registration stores local paths under `~/.spark/`; it does not duplicate the binaries. Keep the registered binaries in place. Set `SPARK_HOME` to isolate local registry state for testing.

Runtime selection checks SDK version, platform, architecture, and native signatures. Missing/deleted runtimes are skipped. A missing prebuilt installation produces installation guidance, while additional native modules or native app configuration produce a custom-build prompt. Runtime downloads are not implemented in this local prototype.

## Advanced overrides

Normal app development needs no flags. These remain available for automation and diagnosis:

- `create --packages <manifest>`: use an explicit local SDK archive manifest.
- `dev --runner-binary <runtime path>`: register and use a particular Spark Runner.
- `--project <directory>`: choose another application directory.
- `dev --port <number>` (or `-p`): Expo chooses the port, defaulting to 8081, and handles occupied-port prompts. Desktop launches use the port Expo reports.
- `dev --no-open`: start the server without an automatic launch. Explicit Expo flags such as `--web` still open their targets.
- `dev --platform ios|android|web|macos|windows`: choose the initial launch target; all declared platforms stay available.
- `dev --clear`, `--offline`, `--lan`, `--localhost`, `--tunnel`, `--max-workers`, and other Expo start options pass through unchanged. `dev --help` includes Expo’s help.
- `dev --go` / `--dev-client`: choose the **mobile** Expo runtime; these do not select the Spark Runner.
- `build --dev`: build a custom Debug runtime and remember it for the next `dev` session.
- `build --preview`: build the production native selection in Debug.
- `build --force`: force native regeneration and compilation for the selected mode.

For SDK maintainers, `sdk build-runner` builds and registers the shared runtime;
`build --runner` builds one from the current generic SDK project. `dev --runner-binary`
selects its binary. These are the only Spark spellings. Internal runtime metadata
uses `go`; Expo's `dev --go` still means Expo Go.

Spark validates flags and positional arguments per command before reading project
state. For example, `package --example notes-lite` and `build --no-open` reject rather
than ignoring options. Device/port build options belong to mobile builds; desktop
launch options belong to `dev`. Expo's own development options pass through to Expo.

## Add native code

The local fixture is distributed in `artifacts/packages/` after packing. Use its content-hashed filename from `artifacts/packages/manifest.json` (the stable alias below is also available for a first installation). Install its tarball with your package manager:

```sh
npm install /absolute/path/to/frame/artifacts/packages/legendapp-spark-native-greeting-0.1.0-prototype.0.tgz
```

Import `getGreeting` from `@legendapp/spark-native-greeting` and render its returned string. The running CLI detects that the Spark Runner lacks the native module and offers a custom build. Press `b` to build and switch. Future JavaScript edits Fast Refresh; native source/configuration changes need another build.

If the current custom binary is stale, press `b` to rebuild it, or run `spark build --dev` followed by `npm run dev`. `spark build --dev --force` forces native regeneration and compilation for a custom development build. Generated native directories are disposable: author native changes in packages/config plugins.

## Inspect and build production selection

```sh
npx --no-install spark analyze
npm run build
```

`spark build --preview` builds the production module selection in Debug configuration. Launch its printed product path with `spark open <app> --port <metro-port>` against a running development server; it requests production JavaScript.

`analyze` bundles for macOS production and writes `.spark/selection-report.json`, including resolved source modules and reasons for native inclusion. `build` regenerates the selected native graph and produces an app with a JavaScript bundle that runs without Metro.

Only SDK native modules are pruned automatically. Unknown third-party native dependencies are retained. Add native-only requirements to `expo.extra.spark.include` in `app.json`, using package names. Set `expo.extra.spark.customRuntime` to require an app-specific binary even without additional modules. Extra native configuration/plugins also require a custom runtime.

The prototype supports static `app.json` configuration. Programmatic app configuration and additional app entrypoints need explicit implementation/validation before they are advertised as supported.

## Native prerequisites

Use Node **24.19.0**, pinned in the checkout's `.nvmrc` (`nvm install && nvm use`). Node 24.12.0 fails to import `AndroidConfig` / `IOSConfig` from Expo's generated CommonJS modules when running Expo Desktop. Create/prebuild and the native doctor check the installed Expo Desktop config exports with the actual Node executable on PATH, so incompatible runtimes fail before native generation. This check does not patch Expo or change the Expo Desktop pin.

`spark doctor` checks macOS, Node, CocoaPods, Xcode, and the macOS SDK. Install full Xcode, complete its first-launch/license setup, and select it with the normal Xcode command-line tools settings. Command Line Tools alone cannot build the generated macOS application. Install CocoaPods in a supported Ruby environment and ensure `pod` is on PATH.

The CLI diagnoses missing tooling; it does not silently install Xcode or accept licenses. Re-run the build or switch after completing setup. No native prerequisites are invoked for a compatible Spark Runner launch.

## Local package iteration

Repack after source changes. The archive manifest maps package names to local tarballs; starters use overrides so transitive framework packages also resolve locally. The archive manifest uses content-hashed filenames to avoid stale package-manager caches. Run `bun scripts/refresh-consumer.ts /path/to/app` from the framework repository to update an existing test consumer. Public package versions will be immutable.

Do not use workspace symlinks as the sole distribution test. The prebuilt builder and consumer should install real tarballs outside both source repositories.

## Logs and generated outputs

- `.spark/commands.jsonl`: invoked build/install commands and working directories.
- `.spark/logs/`: full command output, including native build logs.
- `.spark/native-selection.json`: input shared by autolinking and codegen.
- `.spark/selection-report.json`: production selection explanation.
- `.spark/*-build.json`: product location and successful native fingerprint.
- `.spark/session.json`: current compatibility gate for the managed Metro session.

Keep generated files out of version control. Commit application source/configuration and its package-manager lockfile.

## Starter template and Expo Desktop integration

Edit the complete templates under `packages/cli/templates/`: `blank-typescript` (macOS), `windows`, or `universal`. Their manifests own dependency pins and scripts. `spark sdk pack` resolves local SDK archives into template dependencies and emits npm tarballs plus `artifacts/packages/templates.json`. Repack after changing a template or SDK package.

`spark create` invokes `expo-desktop@1.0.0 create-app --template <archive>`. Expo Desktop validates the directory/name, extracts files, assigns app/native identity, installs dependencies, and initializes Git. A template postinstall initializes spark's configuration once. It does not overwrite an existing project ID or user edits. Project basenames must be alphanumeric, following upstream validation; spaces in parent directories are supported.

Direct Expo Desktop template creation is also checked by `bun run test:templates`, including a consumer outside the checkout. These local archives reference local SDK tarballs; they are not a published package distribution. The [integration handoff](expo-desktop-integration.md) documents the npm compatibility pin and remaining build/launch limitations.

See [Intel macOS targets](macos-intel.md) for architecture selection and dual-architecture Runner releases.
