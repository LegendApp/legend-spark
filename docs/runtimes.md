# Background JavaScript on macOS

[Margelo Runtimes](https://github.com/margelo/react-native-runtimes) is an external library integrated into the SDK, available in prebuilt and custom development builds. Its API is imported directly from `@react-native-runtimes/core`; the framework handles native setup, Metro and production selection. New projects declare the library as a dependency automatically. It runs JavaScript on independent Hermes runtimes inside the app process. No Node runtime is packaged. A worker can continue while the app is hidden or its windows are closed; it ends when the app quits. This is not an OS service that runs after termination or through system sleep.

## Usage

Put exported tasks in `tasks.ts` or under `src/`. Use the literal `runtimeFunction` export name so the upstream compiler can discover them. Pass data as arguments; closures and module globals are not shared between runtimes.

```ts
// src/tasks.ts
import { runtimeFunction } from "@react-native-runtimes/core";

export const summarize = runtimeFunction((values: number[]) => {
  return { count: values.length, sum: values.reduce((a, b) => a + b, 0) };
});
```

```ts
import { ThreadedRuntime } from "@react-native-runtimes/core";
import { summarize } from "./src/tasks";

const workerName = "analysis";
try {
  const result = await ThreadedRuntime.run(workerName, summarize, [1, 2, 3]);
  console.log(result); // { count: 3, sum: 6 }
} finally {
  await ThreadedRuntime.destroy(workerName);
}
```

Keep a named runtime around for repeated jobs when retaining its heap is useful. Use distinct names for independent features. Await outstanding work before destroying its runtime: the pinned upstream API does not guarantee settlement of every in-flight call when it is destroyed. Destruction is not task cancellation or a rollback of native side effects.

`ThreadedRuntime`, `runtimeFunction`, identity helpers and other APIs belong to Margelo Runtimes. See the [upstream source and documentation](https://github.com/margelo/react-native-runtimes/tree/58710c25c6e505dcc1292ee54d855408a6f7a42d/packages/core) for its API. Threaded UI surfaces and `@react-native-runtimes/state` are not part of the validated background-execution support.

Arguments/results use JSON serialization in this pinned version. Use plain serializable data; functions, cyclic objects, BigInt, native handles and class instances are unsuitable. An `async` task can use timers and return a result or throw an error. A worker's imports execute in its own heap. Native filesystem access is verified; native libraries with UI ownership, singleton state or event emitters need separate multi-runtime verification. Keep window/menu/UI operations on the main runtime.

## Development and production

New projects have the required Metro wrapper and worker-aware entry. No app config flag, config plugin or manual native-module manifest entry is needed.

- prebuilt and custom dev builds include the SDK's patched Runtimes and Nitro native code. Workers start lazily.
- `spark build` / `spark package` first bundle the actual application with worker registrations suppressed. They then generate registrations from reachable source files, rebundle, and select native modules from that graph.
- If the app does not import Runtimes, production excludes its JS, native pod and native startup hook. Nitro is also excluded unless another retained native package requires it.
- Files left in `src/` or `tasks.ts`, installed SDK packages and development-generated registrations do not by themselves retain Runtimes in production. Imports used only inside reachable worker functions retain their native dependencies.
- This is module reachability, not per-function dead-code elimination. An imported module that imports Runtimes retains it even if one exported function is never called. An explicit native `include` override remains authoritative.
- Main-app reload clears workers before React Native reloads the application. Fast Refresh is not a worker-state migration mechanism; perform a full reload after changing task registrations or when a clean worker heap is needed.

Only source modules reachable from the app are worker entry points in production. Reference exported tasks from the app's import graph. Arbitrary unreferenced `index.<runtime>.ts` side-effect entries are not implicitly kept in production.

## Existing projects

Replace `@legendapp/spark/runtimes` imports with `@react-native-runtimes/core`. The previous framework `createRuntime` helper has been removed; use upstream `ThreadedRuntime.run(name, task, ...args)` and `ThreadedRuntime.destroy(name)` as above. Declare core in the app dependencies when migrating an older project with `npm install @react-native-runtimes/core@0.1.0-alpha.2`; retain the SDK-pinned archive override installed by the SDK refresh.

Refreshing local SDK packages upgrades the exact original generated entry/Metro pair. For customized projects, compose these changes manually while retaining your other configuration:

```js
// metro.config.js
const { makeMetroConfig } = require("expo-desktop-metro-config");
const { withDesktop } = require("@legendapp/spark/metro");
module.exports = withDesktop(makeMetroConfig(__dirname));
```

```ts
// index.ts — do not eagerly import your main App in secondary runtimes.
require("@legendapp/spark/runtime-entry");
if (!(globalThis as any).__THREADED_RUNTIME_ENV__) {
  const { registerRootComponent } = require("expo");
  registerRootComponent(require("./App").default);
}
```

Ignore `.threaded-runtime/` in Git. Remove the prototype's `runtimes.plugin.cjs` from the config plugins list. Rebuild the Spark Runner or your custom dev binary after updating the SDK; reloading Metro cannot add native code to an older binary.

## Pinned source and local distribution

The SDK pack step fetches Margelo's repository at `58710c25c6e505dcc1292ee54d855408a6f7a42d`, applies the checked-in patches, and includes a normal patched core tarball in the SDK manifest. App installation needs no patch hook or upstream checkout. Core is `0.1.0-alpha.2`; Nitro is pinned to `0.35.7`.

`patches/react-native-runtimes-macos.patch` contains the five-file macOS port for an upstream PR. `patches/react-native-runtimes-integration.patch` separately adds graph-selected entry generation, dispatcher cleanup and a worker-only event fallback. The packaging recipe and patches participate in the archive cache key; generated Nitro sources participate in native compatibility fingerprints. Keep these pins together until an upstream version replaces the patches.

```sh
bun run pack:local
bun run spark sdk build-runner
bun run test:runtimes /tmp/SparkRuntimesProbe --prebuilt
bun run test:runtimes /tmp/SparkRuntimesProbe
bun run test:runtimes /tmp/SparkRuntimesProbe --release
bun run test:runtimes:pruning /tmp/SparkRuntimesProbe
```

`bun run test:runtimes:all` prepares the Spark Runner and runs the complete matrix; it is also included in `test:all`.

The native test app measures worker isolation, imported CPU work while the main JS timer ticks, async results, errors, filesystem access, runtime destruction after completed calls and fresh recreation. Dev/prebuilt additionally perform an actual app reload. The pruning test retains task source files and dependencies, removes their imports, verifies the native selection and linked symbols, and launches the resulting standalone Release app. Local Xcode is required for these native builds.

Recorded results: [integrated Runtimes validation](runtimes-validation.md).

## Windows development backend

Windows now has a source implementation behind the same Margelo API. The framework
creates a React Native Windows host and Hermes runtime per name, installs runtime
identity before bundle evaluation, and loads the generated Metro worker entry.
Calls queue until the complete bundle loads; destruction/load failure rejects
pending calls, and calls have a 120-second timeout. Reload of the owning main
runtime unloads its workers. The native-call transport carries JSON results and
errors; it does not execute worker functions on the main heap. Threaded surfaces
use nested RNW ContentIslands with visible initialization errors.

The SDK's prebuilt profile includes the backend. A custom Windows development
build includes it when `@react-native-runtimes/core` is installed. `withDesktop`
enables the existing upstream scanner when the package is present, including
universal desktop projects. Build inputs include the host and patched package
source, so an older prebuilt executable cannot silently satisfy the new API.

This is source integration, not native Windows verification. Run the shared
platform checks for heap isolation, identity, async timers, errors and recreation;
then test native filesystem access, reload during work, and threaded UI separately.
As on macOS, OS UI modules have main-window ownership. Standalone Windows
production bundling/pruning is part of the deferred distribution work.

Windows workers own their native module instances. `useMainNativeModules: true`
(and `prewarmBusinessRuntime`, which requests it) rejects explicitly. The Windows
backend supports named secondary runtimes; it does not route worker calls back to
the main heap. These optional upstream modes need separate integration work.
Desktop application events and quit guards are main-runtime APIs on Windows:
the host emits those events through the main React context, and worker-local
listeners cannot receive them. Keep window and OS UI listeners on the main runtime;
do not treat native module availability in a worker as proof of event support.
