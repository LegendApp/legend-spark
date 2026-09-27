# App-supplied helper processes

spark packages and launches executables supplied by the application. It does not
include Node, choose a backend language, download binaries, or compile helper
projects. A Rust, Go, C/C++, or self-contained executable can use the same API.
A runtime-dependent executable must bring its runtime and dependent files.

## Configuration and layout

```json
{
  "helpers": {
    "backend": {
      "macos-arm64": { "directory": "helpers/backend/macos-arm64", "executable": "bin/backend" },
      "windows-arm64": { "directory": "helpers/backend/windows-arm64", "executable": "backend.exe" },
      "windows-x64": { "directory": "helpers/backend/windows-x64", "executable": "backend.exe" }
    }
  }
}
```

Put this under `desktop.config.json`. Existing Expo-owned projects use the same
spark overlay. Selection uses the **build target**, including
`SPARK_WINDOWS_ARCH`, rather than the architecture of the running CLI process.
A missing target fails the build. macOS currently builds arm64; accepting a
`macos-x64` declaration does not add x64 app-build support.

`directory` is relative to the project; `executable` is relative to that directory.
Keep assets, shared libraries, and child executables in the bundle. Entries must
be plain files/directories, with no symlinks, traversal, or special files. Helper
names are case-insensitively unique. `.spark-entry` is reserved metadata.
Legacy `"helpers": { "tool": "bin/tool" }` declarations still copy one file.

The layout is `Contents/Helpers/backend.helper/...` on macOS and
`Helpers/backend.helper/...` beside the Windows host executable. Internal relative
paths are preserved. The helper target resolves `backend` through the generated
entry metadata; application code does not depend on installation paths. Resolve
read-only assets relative to the executable, not the inherited working directory.
Write mutable data into application storage, never into the installed bundle.

Every bundled file contributes to build compatibility, so changing an asset or
library requires rebuilding, just like changing the helper executable. Helpers
require a custom application binary; they cannot extend a shared Spark Runner
at JavaScript startup. Fast Refresh still handles JavaScript-only edits.

## API and ownership

```ts
import { spawn } from '@legendapp/spark/processes';

const child = await spawn({
  target: { type: 'helper', name: 'backend' },
  args: ['--stdio'],
  onOutput: chunk => {
    // chunk.stream is stdout or stderr; chunk.bytes is Uint8Array.
  },
});
await child.write('a request\n');
await child.closeInput();
const result = await child.exited;
```

`spawn` means the operating system launched the executable; it does not mean the
service is ready. Use an application-level readiness message and timeout when
needed. Each call starts a new process. Keep one process handle in an app-level
service if several windows need it; do not spawn from every screen render.
Closing one window does not own or terminate this service. Effect-owned processes
should call `terminate()` from cleanup, including during Fast Refresh.

Processes belong to the native module/runtime, not a durable background service.
A full runtime teardown stops them; normal application quit stops them.
`terminate()` resolves after the process tree exits and both output streams drain.
Concurrent termination calls join; failed native termination remains retryable.
`exited` also exposes the captured output and exit result.
On macOS cancellation sends SIGTERM to the process group, followed by SIGKILL
if it is still running after two seconds. Root-process exit kills remaining group
members so descendants cannot hold output pipes open forever. Children must not
escape the group by daemonizing. Abrupt app crashes/SIGKILL do **not** currently
guarantee macOS cleanup. Do not use this as an OS service manager.
Windows uses a kill-on-close Job Object; root exit and cancellation terminate the
job, and OS handle cleanup also covers abrupt app death. Descendant behavior and
runtime teardown still need native Windows acceptance testing.

Arguments bypass a shell. Environment overrides merge with the inherited process
environment; do not put secrets in command-line arguments. `cwd` is an optional
absolute working directory. `input` and `write()` accept UTF-8 strings or `Uint8Array`. Writes resolve after the native pipe write,
so await them rather than queuing unbounded writes.

Output callbacks receive byte chunks with arbitrary boundaries. Decode text with a
streaming `TextDecoder` when needed; a chunk is neither a UTF-8 character boundary
nor a protocol message boundary. Both streams continue draining after capture
reaches `captureLimitBytes` (default and maximum 8 MiB per stream, zero disables
capture); `outputTruncated` reports discarded captured bytes. Streaming callbacks
still receive all bytes. Results expose `stdout` and `stderr` as `Uint8Array`.

Targets are explicit: `{ type: "executable", path }` takes an absolute native path
or local file URL; `{ type: "helper", name }` selects a packaged helper; and
`{ type: "command", name }` resolves a basename through the host PATH. The lookup
uses absolute PATH entries only. macOS also checks conventional user/system tool
locations; Windows uses [SearchPathW](https://learn.microsoft.com/en-us/windows/win32/api/processenv/nf-processenv-searchpathw)
with an explicit PATH and `.exe` default extension (`.com` may be named explicitly),
without shell/batch parsing.
`resolveCommand(name)` returns the resolved absolute path or `null`. Per-process
`env.PATH` overrides affect the child environment, not host command lookup.

Startup failures reject `spawn`. Nonzero child exit is an expected result:
`exit` is `{ type: "exited", code }` or `{ type: "terminated", signal }`. The signal
is the POSIX number on macOS and `null` for Windows job termination. `timedOut`
marks the native deadline, `aborted` marks an AbortSignal received before exit,
and capture truncation is reported separately. These flags can overlap a natural
exit when cancellation races completion. Pre-aborted launches reject `E_ABORTED`;
once launched, cancellation terminates the process tree and returns partial
output through `exited`. Invalid native data and transport errors reject.

`runCommand` closes stdin after initial input and waits for exit using the same
options and result. The separate command-runner object, mock facade, and
`/processes/commands` import are removed. For sequential work, await each call in
a loop; use `Promise.all` for explicit concurrency. No retry/restart/batch policy
is imposed. Callers can inject the `spawn`/`runCommand` functions into their own
services, as the sidecar example does.

## Distribution

Bundles are copied before macOS signing. The existing signing traversal signs
nested Mach-O executables and libraries inside out before signing the app; use
`signing`'s existing nested entitlement overrides for helper-specific needs. For
example, the target path is `Contents/Helpers/backend.helper/bin/backend`.
Do not grant a helper the app's entitlements implicitly. Configure library load
paths relative to the executable/bundle when building the helper.
Whole-app distribution carries the matching helper version with it.

Windows development products include helper bundles. Windows production
packaging, signing, and whole-app updates remain a separate framework gap; this
feature does not claim to implement that pipeline.

## Example and verification

See [the standalone C example](../examples/sidecar/README.md). On macOS:

```sh
npm run spark -- build --dev --project examples/kitchen-sink
node scripts/test-sidecars.ts
```

The probe copies the built app, installs the compiled example bundle, ad-hoc signs
it, runs real React Native API checks, and removes the disposable app. Logs and
`report.json` stay under `.spark/sidecar-tests`. It tests helper lookup, failures,
Unicode input, binary output beyond the capture cap, timeout, window ownership,
macOS descendant cleanup, prompt readiness delivery, and cleanup of a live helper
on normal application quit. It does not validate Developer ID notarization or
abrupt macOS crash cleanup.

On Windows, compile `echo.c` and `worker.c` for the host target, add both to Kitchen Sink's helpers
configuration using the example, build a **custom development app**, and launch
its executable with `--spark-test-report <absolute-report-path>
--spark-sidecar-probe` while Metro is running. The portable probe covers lookup,
I/O, failures, timeout, window ownership, and the worker readiness/request protocol. Separately verify Job Object cleanup
by closing/reloading the host and by killing the host while helpers and their
children are running. These native Windows results are pending.

## Request/response service example

The [sidecar example](../examples/sidecar/README.md#complete-requestresponse-example)
now includes a worker executable, bounded client protocol, application-owned service,
and a React Native UI. It demonstrates readiness, correlated concurrent requests,
binary-safe framing, timeouts, crash handling, explicit restart, and graceful stop.
These remain example-owned policies; the framework process API stays language- and
protocol-neutral. For large input files, use [streaming file I/O](file-streams.md)
or pass a validated path to an app-owned helper instead of one enormous message.

Validated on macOS on 2026-09-17: the real native sidecar probe passed all nine
checks, including binary worker requests, crash/restart, readiness/request timeouts,
and normal app-quit cleanup. Portable client tests also split replies into three-byte
fragments to exercise framing independently of OS pipe chunking.

The API cleanup is additionally covered by a lightweight test executing the actual
macOS native implementation (with the React bridge replaced by a test transport).
It checks binary stdin/stdout, capture limits, SIGTERM/timeouts, nonzero exit and
descendant cleanup. The prior September 17 app acceptance used the earlier API;
full RN-host and Windows acceptance of the revised contract remain pending.
