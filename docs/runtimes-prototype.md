> The prototype is now integrated into the SDK. See [background runtime support](runtimes.md) for the current API, setup and production pruning. The notes below describe the initial experiment.

# Margelo Runtimes on macOS — prototype

The background-execution prototype uses Margelo's `@react-native-runtimes/core`
source at commit `58710c25c6e505dcc1292ee54d855408a6f7a42d` (package version
`0.1.0-alpha.2`), with `react-native-nitro-modules` 0.35.7, React Native 0.81.6,
React Native macOS 0.81.7 and Expo Desktop beta.5. No Node runtime is embedded.

This is an isolated custom-build experiment. It does not change the default SDK,
Go runtime or public API. The example also offers a button to open the existing
desktop kitchen sink.

## Reproduce

From the framework checkout, with the normal macOS build prerequisites:

```sh
bun run test:runtimes /tmp/SparkRuntimesProbe
# Also prove worker startup from an embedded bundle, with no Metro:
bun run test:runtimes /tmp/SparkRuntimesProbe --release
# Run the checks and leave the example visible for interaction:
bun run test:runtimes /tmp/SparkRuntimesProbe --interactive
```

The runner creates a managed kitchen-sink consumer, checks out the pinned upstream
revision in its `.spark` directory, applies the patch, packs that source locally,
installs Nitro and configures Metro/CNG. It requires network access on first setup.
It does not publish anything. `--prepare-only` stops after preparing the consumer.
`--force` regenerates the native project if the prototype CNG hook is edited.
Reports and logs go to `.spark/runtimes-proof/` inside the consumer.

The root framework typecheck excludes this optional example because its dependencies
are only installed in the probe. Check the prepared consumer separately:

```sh
cd /tmp/SparkRuntimesProbe
npx --no-install tsc --noEmit
```

On this development Mac, Bun stalls in the Documents checkout, so the actual
runner was executed from a synchronized `/tmp/spark-sdk-validation` copy.
The permanent source, patch and documentation remain in `spark`.

## Compatibility patch

[Upstream patch](../patches/react-native-runtimes-macos.patch) changes five files:

- Add macOS 14 to the pod's supported platforms.
- Use React Native macOS's `RCTUIView` for the optional surface wrapper, and
  AppKit view/color types where needed; retain the original iOS branches.
- Enable the native runtime methods on macOS. Upstream currently returns early
  or executes the function on the calling thread for platforms other than iOS/Android.
- Enable the Apple event-emitter fallback on macOS as well.

The patch applies at the upstream repository root:

```sh
git checkout 58710c25c6e505dcc1292ee54d855408a6f7a42d
git apply /path/to/spark/patches/react-native-runtimes-macos.patch
```

The framework-specific [CNG hook](../examples/runtimes/runtimes.plugin.cjs)
configures `ThreadedRuntime` with the existing React Native factory delegate before
launch. It runs after the framework replaces AppDelegate, so CNG preserves the
hook. No upstream Hermes engine or scheduler changes were needed.

The example uses upstream `runtimeFunction(...)` and `ThreadedRuntime.run(...)`
directly. Metro discovers functions in `tasks.ts`; the Release entry gates normal
app initialization so a secondary runtime does not mount the main application.

## Evidence

Both the Debug development run and standalone Release run passed all six checks.
The Release runner did not start Metro; both runtimes used the embedded bundle.
Framework tests passed (109 tests / 418 assertions), and framework and consumer
TypeScript checks passed. Local logs and JSON are saved under
`docs/evidence/runtimes-2026-09-12/` (ignored by Git).

Checks:

1. A named secondary runtime reports `isMain: false`; repeated calls retain its
   own state while the main runtime has a separate counter.
2. Two seconds of CPU work using imported `fast-json-stable-stringify` completes
   on that runtime. The main JS timer ticks 75 times with a maximum measured gap
   of 28 ms (25 ms requested interval). This is a responsiveness smoke test,
   not a production performance benchmark. The Release run also recorded 75 ticks
   and a 28 ms maximum gap during its two-second workload.
3. Async timers execute and structured results reach the caller.
4. A thrown worker exception rejects the caller with the original message.
5. The worker reads a test file through the framework's native filesystem module.
6. Destroy removes the runtime from the registry; recreating it starts with fresh
   module state. This is not a memory-leak stress test or hard-cancellation test.

A final computer-use visual check was blocked because the Mac was locked. The
automated checks run inside the real native app; screenshots and manual button
interaction are not claimed as verified.

## Boundaries before SDK adoption

- Background execution is inside the app's process. It is not crash isolation,
  an OS service, or execution after the user quits the app.
- Only the native filesystem module was tested from the secondary runtime.
  Other modules need an ownership/thread-safety audit; process-wide native state
  and event sinks must not be inadvertently replaced by another runtime instance.
- Cooperative cancellation, work in flight during destruction, full reload cleanup,
  debugger behavior and repeated-runtime memory usage need further testing.
- The optional threaded **UI** surface compiles, but this experiment exercises
  background functions, not React rendering on secondary runtimes.
- `@react-native-runtimes/state` was not included. We do not need to choose a
  shared-state implementation to prove background JavaScript execution.
- Go inclusion, supported-version pinning, public downloads and a framework-owned
  background API are separate integration work after this prototype.
