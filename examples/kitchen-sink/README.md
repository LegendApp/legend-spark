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

The run commands open Expo's development terminal and discover a compatible
registered Spark Runner. Edit the screens, framework JavaScript, or CSS for
Fast Refresh. The theme defaults to System; the header button cycles through
System, Light, and Dark. Native changes invalidate the old runtime and require an
explicit rebuild.

## Install or rebuild the native runtime

JavaScript dependencies do not include a native executable. There is no hosted
prebuilt download service yet. If a matching runtime is already registered, the
run command uses it without compiling. You can register one supplied by another
machine with `bun ../../scripts/spark.mjs sdk register <runtime-directory>`.

To build and register a matching Spark Runner locally, run one of these **once**
with the platform's native toolchain installed, and again after native changes:

```sh
bun run rebuild:macos
# On Windows (including ARM64 Parallels):
bun run rebuild:windows
```

These compile the reusable runtime containing this app's native dependencies.
Subsequent `bun run macos` / `bun run windows` starts Metro and opens that runtime.
Use `--no-open` to start only the development terminal, or `--port 8082` to choose a
port. An old incompatible runtime stays gated until you explicitly rebuild; startup
never silently compiles. See [Windows setup and acceptance](../../docs/windows-slice.md).

The application identity and configuration live in `desktop.config.json`. Switching
platforms preserves them. Generated native projects and `.spark` state stay local
and ignored by Git. The example currently exercises desktop-only APIs; the separate
Settings example demonstrates mobile/web sharing.

## Framework maintenance and integration tests

From the repository root, `bun run kitchen-sink` is a shortcut for this app's `dev`
script. `bun run kitchen-sink:prepare` deliberately packs the SDK and creates a
separate consumer under `.spark/examples/KitchenSinkPackaged` for integration tests.
It never overwrites this app's manifest, identity, or native projects.

External-library adapter changes use `bun run sync:workspace-patches`, then
`bun run postinstall`. That maintainer command derives the install patches from
the same pinned recipes as SDK packing. It is not part of normal startup.
