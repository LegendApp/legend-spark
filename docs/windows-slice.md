# Windows development support

Windows development is integrated into the spark CLI, starter, config plugin, host package, runtime registry, native compatibility checks, and Metro session. There is no separate client toolkit or source ZIP to install.

The current scope is prebuilt and custom development builds on Windows x64 and ARM64 (including Windows on Apple Silicon Parallels). The Windows starter exercises the native host without installing the macOS SDK feature set. The existing `@legendapp/spark-native-greeting` fixture has a Windows implementation for testing the transition to a custom build. The SDK prebuilt profile includes desktop modules, Nitro, SQLite, WebView2, and secondary Hermes runtimes. Production builds and packaging remain outside this development scope. All Windows native implementations await compilation and acceptance.

**Validation:** typechecking, repository tests, packed Windows starter creation, repeated prebuild, development bundles, and native graph invalidation have passed on macOS. Windows native compilation, autolinking, launch, Hermes execution, and Fast Refresh still need a Windows run. A successful JavaScript bundle does not establish native support.

## Set up the Windows machine

Use Windows 11 x64 or ARM64 with an interactive desktop, Node.js 24.19.0 (the tested version in `.nvmrc`), a package manager (npm is included with Node), Git, PowerShell 7 (`pwsh.exe` on PATH), and the React Native Windows native prerequisites. The pinned RNW 0.81.35 template uses **Visual Studio 2026 / MSVC v145**. Its prerequisite script checks VS 18.6.1+, .NET SDK 10, and the Windows 11 SDK 22621 component; an older VS 2022-only installation does not match this template. See [RNW environment setup](https://microsoft.github.io/react-native-windows/docs/getting-started).

Use this repository normally. From its root in PowerShell:

```powershell
npm install
bun run spark sdk pack --platform windows
bun run spark create C:\dev\SparkWindowsApp --platform windows
cd C:\dev\SparkWindowsApp
```

Windows is the default creation target when running on Windows; the explicit flag also allows generating a Windows project on macOS. Keep generated apps outside OneDrive and use a short path. Install dependencies on Windows instead of copying macOS `node_modules`.

The packed SDK contains the CLI, host hooks, config plugin, templates, and native fixture. SDK packing prepares Runtimes and the pinned external-library Windows adapters on either host OS, using JavaScript patch application. No additional source kit is needed.

Check the native prerequisites using the script shipped with the pinned RNW version:

```powershell
pwsh -File node_modules/react-native-windows/Scripts/rnw-dependencies.ps1
```

It checks by default; `-Install` installs missing prerequisites from an elevated terminal. Restart your terminal after installation so tools are on PATH.

## Parallels and target architecture

Windows on Apple Silicon Parallels defaults to a native ARM64 build. The CLI detects the Windows CPU independently of the Node process architecture; an emulated x64 CLI is allowed. Install the **MSVC v145 ARM64/ARM64EC build tools** in Visual Studio Installer alongside the RNW prerequisites. The project still comes from the pinned Expo Desktop beta template and delegates the target to [RNW's `--arch` option](https://microsoft.github.io/react-native-windows/docs/run-windows-cli/); no upstream patch or separate source kit is needed for architecture selection.

To explicitly select a target in PowerShell (for example, to test x64 under Windows ARM emulation):

```powershell
$env:SPARK_WINDOWS_ARCH = "x64" # or "arm64"
bun run spark sdk build-runner --platform windows
```

Keep that environment variable set for subsequent build and dev commands. `Remove-Item Env:SPARK_WINDOWS_ARCH` restores automatic selection. On macOS, Windows project generation defaults to x64; set `SPARK_WINDOWS_ARCH=arm64` to check ARM64 metadata and generation. Native compilation still requires Windows and the matching compiler tools.

The CLI passes `PreferredToolArchitecture=x64` to RNW's x64 MSBuild process. This selects the 64-bit compiler host while preserving the requested app architecture, and avoids x86 compiler address-space failures when loading large precompiled headers. An `arm64` compiler-host preference is reset to x86 by Visual Studio when MSBuild itself runs as x64.

Runtime fingerprints, output directories, and prebuilt discovery distinguish x64 and ARM64. Both runtimes can be registered together; discovery selects the current target. The build record tracks the last build for each mode, so changing architecture can cause another build while preserving the other architecture’s binary. Native acceptance is pending on **both** architectures; ARM64 selection does not establish that every native dependency compiles or runs on ARM64.

On 2026-09-15, the ARM64 prepare verifier passed packed starter creation, Expo Desktop beta prebuild, both development bundles, and native dependency invalidation on macOS. Repository tests also passed with the ARM64 override. These checks do not run MSBuild or execute a Windows binary.

## Normal framework workflow

Inside the generated app:

```powershell
npx --no-install spark sdk build-runner --project .
npm run windows
```

`windows`, `dev`, and `start` use the same `spark dev` implementation. The Spark Runner is saved under the selected platform’s state directory at `products/<arch>/go/SparkWindows`, with `go-build.json` recording the latest build, and registered in the normal spark runtime registry. Registry discovery checks the platform and architecture so a macOS runtime cannot be selected for Windows.

Edit `App.tsx` to test Fast Refresh. Click the counter first and confirm it retains its value after a text edit. The native window title uses the current project's launch identity even when the Spark Runner was built from another starter. The desktop SDK now includes Windows implementations; see the [acceptance matrix](windows-issues.md) for limits and unverified behavior.

The session uses Expo CLI with desktop keys: `d` opens Windows, `g` switches between the Spark Runner and a custom development build, and `b` builds when required. Expo owns `r` for reload, `j` for debugging when supported by RNW/Expo, and Ctrl+C to exit. Its `w` still opens web and `s` still switches the mobile runtime. Adding a supported native dependency or changing its native source invalidates an incompatible runtime; the session stops its owned app and offers a development build.

A direct custom build uses the same command as macOS:

```powershell
npx --no-install spark build --dev
npm run dev
```

Windows `spark build` without `--dev`, preview builds, and distribution packaging are intentionally unsupported. Native compilation must run on Windows. The selected target is stored in `desktop.config.json` as `"platforms": ["windows"]`; subsequent commands read that configuration. Universal projects preserve generated platform projects and configuration when switching targets.

For a reusable generic SDK Spark Runner, run from the framework checkout:

```powershell
bun run spark sdk build-runner --platform windows
```

This uses the platform-specific SDK build directory and the same runtime registry. Apps created against the matching packed SDK discover it automatically.

## Automated native verification

From the framework checkout, after packing the SDK and installing native prerequisites:

```powershell
bun run test:windows --project C:\dev\SparkWindowsVerification
```

Choose a fresh destination. The verifier calls the real starter, builds the Spark Runner through `spark sdk build-runner`, and launches the installed CLI's `spark dev` session. It checks the compiled native host identity and Hermes, edits a file to test Fast Refresh, installs the existing `native-greeting` fixture, waits for the shared session to reject the Spark Runner, then sends the normal `b` command and checks the custom native greeting. It also checks that building custom did not change the saved prebuilt executable.

Keep the desktop session unlocked. Native compilation and initial NuGet downloads can take several minutes. The verifier exits nonzero on failure. It installs a native fixture, so use a new destination for a complete second run.

Send back these generated files if it fails:

- `.spark/windows-verification.json`: completed stages, native reports, and the failing stage.
- `.spark/commands.jsonl`: commands and working directories.
- `.spark/logs/`: build and Metro diagnostics, including `windows-session.log` and MSBuild logs.

If the GUI exits without console output, also include any error dialog or Windows Event Viewer application error. A build success alone is not a passing verification.

Generation and both Windows development bundles can be checked on macOS through the same framework code:

```sh
bun run spark sdk pack --platform windows
bun run test:windows:prepare --project /tmp/SparkWindowsCheck
```

This mode explicitly reports that native execution was not verified. RNW platform discovery may log that Windows PowerShell is unavailable on macOS; the project's platform declaration still lets Metro select the Windows sources.

## Known issues

Track missing implementations, safe placeholders, and native acceptance in [known Windows issues](windows-issues.md). Windows stays in shared screens; a missing UI implementation must not fail during import or render.

## Implementation and next steps

The CLI's Windows build adapter uses the shared build lock, runtime schema, native graph, build records, registration, and development session. `@legendapp/spark-desktop-config` installs the Windows hooks from `@legendapp/spark-desktop-host/windows`. The host embeds the same runtime metadata written to the build record. Native packages use RNW's ordinary autolinking pipeline.

The development solution excludes the packaging project. The app uses `WindowsPackageType=None` and `WindowsAppSDKSelfContained=true`, following Microsoft's [unpackaged Windows App SDK guidance](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/self-contained-deploy/deploy-self-contained-apps). The entire native output directory is retained so its DLLs accompany the executable. These are Debug builds for a configured developer machine; compiler-free distribution to clean machines remains unverified.

The framework detects supported Windows native packages and rejects directly installed native dependencies without a Windows implementation. This does not establish support for every third-party dependency graph or arbitrary native project customization. The SDK prebuilt profile includes the Windows modules. `bun run test:platform --platform windows` creates a fresh consumer and exercises their shared acceptance cases.

No upstream Expo Desktop change is needed to attempt this. Jamie can help if the native verification exposes a Windows bootstrap/prebuild problem, and later with the shared `expo-desktop run windows --binary` contract. The Windows report provides a concrete reproducer for that work.

## Application examples and host integration

The [small examples](example-apps.md) are integrated universal projects. The latest
host source adds secondary RNW Composition windows on the same ReactNativeHost,
close/quit guards, focused shortcuts, basic Win32 menus, main-window geometry,
queued/warm open events, and project-scoped AsyncStorage configuration. Music Lite
adds MediaPlayer playback. These are source implementations pending a Windows
build and interaction check; see the [Windows acceptance matrix](windows-issues.md).

The examples retain Expo Desktop beta generation. No separate Windows source kit
is required. After updating SDK archives, rebuild the Windows prebuilt/custom client:
old binaries cannot expose the new host hooks or audio module. Native package
sources ship in their SDK archives.
