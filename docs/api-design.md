# Public API design

Spark capabilities must be usable from ordinary application code: services, stores,
commands, and event handlers. React Native is the runtime; a mounted React component
is not a prerequisite for using a capability.

## Imperative core, optional React bindings

Implement reusable behavior in an imperative function, resource handle, or controller
first. It owns validation, native calls, ordering, cancellation, event delivery, and
cleanup. Keep that implementation in a module that does not import React hooks.
Export the core and any React bindings from the same feature path; no `/react` path
or separate non-React product abstraction is needed.

A hook delegates to that core. It handles React-specific concerns: effect setup and
cleanup, committed callback freshness, resource replacement when identity changes,
and rendering readiness or subscribed state. Do not implement a second copy of the
feature's behavior in the hook. Do not make a caller reproduce a hook's debouncing,
request routing, or state coordination to use the feature outside React.

Distinguish two kinds of hooks:

- **Owning:** creates a resource for a component lifetime and disposes it on unmount.
  `useAudioPlayer(source)` wraps `createAudioPlayer(source)`. Application-wide playback
  uses the factory and the application's own shutdown boundary.
- **Observing:** subscribes to a resource supplied by its caller. Unmount removes
  that subscription; it must never dispose the caller's resource. Add an observation
  hook when there is a useful rendering need, rather than creating one automatically.

Functions such as reading a file, opening a dialog, or showing a notification usually
need no hook. Context access such as `useWindowId` and actual UI components are
inherently React-specific and need no invented imperative equivalent. Keep those
exceptions explicit.

## Direct adapters and execution cost

An adapter translates the public contract and calls the implementation directly.
Use the implementation's native queue, binding snapshots, resource ownership and
error behavior where they satisfy that contract. Do not duplicate them in JavaScript.
Avoid async pass-through functions, success-path Promise chains, rebuilt row/event
objects and copied buffers unless a documented semantic difference requires them.
Normalize only the values the caller requests, in the implementation's fresh result.

Extra coordination belongs to the operation that needs it: for example, a
multi-statement transaction callback may reserve a connection; an ordinary query
should enter the native queue immediately. Define the required guarantees before
adding coordination. Preserve those guarantees with boundary tests, and compare
adapter throughput and allocations against the direct implementation for frequently
called APIs. A stable Spark API does not justify a second execution framework.

## Lifetimes and readiness

Give owners explicit cleanup (`remove`, `close`, or the feature's documented disposal
method). Stop callbacks immediately when cleanup starts, join concurrent cleanup,
and allow retry after native cleanup failure. Never let a stale owner dispose a
replacement resource. Define what happens to accepted in-flight work.

Keep resource creation out of render. Owning hooks must clean up registrations that
arrive after unmount, tolerate Strict Mode setup/cleanup, use current committed
callbacks, and expose setup errors. Report cleanup failures with the handle when
retry is possible. Do not equate an effect running with application startup occurring
exactly once; an app-owned lifetime belongs in an imperative controller.

Expose asynchronous readiness honestly. Factories usually return a promise. A
controller that supports cancellation during setup can return a handle with `ready`
and `remove()` immediately; document what readiness acknowledges. Hook loading/ready/error
state is a React binding, not a replacement for an imperative handle.

## Review and verification

`tests/api-hook-policy.test.ts` discovers hook exports through the public Spark
entry points. Each must identify an exported imperative core or an explicit
React-only rationale. It also checks that the core's implementation module does not
import React. Update that inventory when adding/removing a public hook. This is an
architectural guard, not proof that the hook delegates correctly.

Test the actual imperative behavior without mounting React. Separately test the
hook's ownership/observation boundary, late setup, unmount, callback updates, and
Strict Mode where applicable. A counterpart existing by name is insufficient:
consumers outside React must get the same reusable behavior.

Examples to follow:

- `packages/audio/src/player.ts` and `hooks.ts`: imperative player lifecycle and an owning hook.
- `packages/documents/src/reload.ts` and `hooks.ts`: imperative debounced reload with a hook adapter.
- `packages/documents/src/controller.ts`: application-owned document/menu/window coordination.
- `packages/desktop-windows/src/windows/primaryWindowLifecycle.ts`: application event coordination without React.

Run the hook policy check and the affected imperative/hook tests, followed by the
workspace TypeScript check. Native validation remains necessary when changing native
behavior; mocked transport tests do not establish platform acceptance.

## Public boundaries and deliberate differences

Use named options/results/events and a clear required subject with a final options
object where appropriate. Add actual supported options, not empty extension bags.
Spark owns capability contracts; upstream integrations retain upstream types explicitly.
Selected Expo methods preserve their selected semantics rather than mechanically
renaming every Spark operation. The family decisions are in `api-contracts.md`.

Keep `remove` for registrations, `close` for IO/storage completion, and meaningful
feature verbs such as process `terminate`. Document asynchronous cleanup and accepted
in-flight work. Preserve original and cleanup failures when both occur. An owning
hook must not acquire a replacement until the previous owner has released ownership;
a rejected cleanup promise must not permanently poison future replacement attempts.

Update `docs/api-export-inventory.json` and run `tests/api-export-inventory.test.ts`
when changing public paths. The baseline dispositions are historical accountability,
not compatibility aliases. Keep consumer examples on current public entry points.
