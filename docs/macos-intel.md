# Intel macOS targets

Spark supports selecting macOS ARM64 or Intel x64 throughout custom development
builds, standalone builds, Runner registration/downloads, and packaging. The
default uses the machine architecture; set `SPARK_MACOS_ARCH=x64` or
`SPARK_MACOS_ARCH=arm64` to override it. Xcode receives `x86_64` for x64.

From a consumer project:

```sh
SPARK_MACOS_ARCH=x64 npx --no-install spark build --dev
SPARK_MACOS_ARCH=x64 npx --no-install spark build
SPARK_MACOS_ARCH=x64 npx --no-install spark package
```

Use the same override for a development session or SDK Runner build. Cross
compilation does not establish that the resulting binary can run on the build
machine. Intel cannot execute ARM binaries; running Intel binaries on Apple
Silicon requires Rosetta. Architecture selection uses the OS-reported machine
architecture, not Node's process architecture; an explicit override is the
reliable choice when working under emulation.

Runtime fingerprints include architecture, native DerivedData and products are
separate per architecture, and runtime discovery rejects mismatched targets.
The project build record points to the most recent build of each mode, so
switching targets can rebuild; preserved products do not overwrite each other.
The project-wide build lock still serializes native generation and compilation.

## Runner distribution

A release can supply either or both `macos-arm64` and `macos-x64`. Missing hosted
assets still require a custom development build; adding this tooling does not
publish an Intel Runner.

Build and sign both targets from the same clean release revision, delaying
assembly until both archives are ready:

```sh
SPARK_MACOS_ARCH=arm64 bun run release:runner --no-assemble
SPARK_MACOS_ARCH=x64 bun run release:runner --no-assemble
bun scripts/prepare-release.ts /path/to/arm64.zip /path/to/x64.zip
```

Assembly rejects duplicate targets and mismatched revisions. It creates one
immutable release containing both Runner assets. Single-architecture releases
can continue to use `bun run release:runner` without `--no-assemble`.

## Validation status

TypeScript and automated fixture tests cover architecture selection, runtime
fingerprints/discovery, release manifests, Runner installation, and Intel
packaging with rejection of a mismatched ARM executable. These tests do not
compile or execute a native Intel app, contact Apple's notarization service,
or publish artifacts.

Before claiming native Intel acceptance, compile the minimal app and full
Runner, exercise native integrations on Intel hardware, and validate a real
signed/notarized distribution. Optional native dependencies and app-owned
helpers must supply x86_64 implementations. Release builds remain opt-in.
