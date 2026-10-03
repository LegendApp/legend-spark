# AI execution

`@legendapp/spark/ai` owns execution helpers for installed Claude and Codex command-line
tools. It uses Spark processes and requires a desktop process host. Installation and
login remain the application's/user's responsibility. Availability is advisory and
does not execute a prompt. No React mount is required.

```ts
import { getAICommandAvailability, runAITool, parseAIJson } from '@legendapp/spark/ai';
const availability = await getAICommandAvailability({ preferredTool: 'codex' });
if (availability.preferredTool) {
  const result = await runAITool({
    tool: availability.preferredTool,
    prompt: 'Return a JSON object containing a greeting.',
    timeoutMs: 30_000,
    signal: abortController.signal,
  });
  if (result.exit.type === 'exited' && result.exit.code === 0) {
    const value = parseAIJson(result.output); // unknown: validate application data.
  }
}
```

`runAITool` retains the process result: stdout/stderr bytes, discriminated exit,
timeout, abort and truncation flags. `output` is trimmed UTF-8 stdout, falling back to
stderr when stdout is empty. Nonzero exit and termination are results; operational
failures reject with Spark errors. `signal`, `cwd` and `timeoutMs` follow the process
contract. Codex model/reasoning settings belong in `invocationOptions.codex`.
The current Codex exec recipe uses ephemeral execution and ignores user configuration
and exec-policy rule files; it does not bypass the CLI's sandbox or approval mechanism.
CLI flags/protocol support depends on the installed tool version.

`buildAIInvocation` exposes the argument recipe without executing it. JSON helpers
extract raw/fenced/prose-wrapped JSON and return unknown/null rather than asserting an
application type. `formatAIErrorOutput(output, { maxLength })` truncates error previews.
Prompts, provider selection, credentials and domain-specific schemas remain application
policy. Importing these helpers does not start a command.

## Codex app-server

`@legendapp/spark/ai/codex` adds the macOS native Codex supervisor, including its
existing exec fallback when the server protocol is unavailable. It is an optional
native capability. `getCodexAvailability()` is safe on unsupported hosts or when its
module is absent. It reports installed-command availability, not authenticated access.
The native backend and Nitro object stay private.

```ts
import { runCodexPrompt, shutdownCodex } from '@legendapp/spark/ai/codex';
const result = await runCodexPrompt(prompt, {
  developerInstructions,
  outputSchema: { type: 'object' },
  reasoningEffort: 'low',
  timeoutMs: 120_000,
});
// Application shutdown boundary:
await shutdownCodex();
```

The supervisor is process-wide. `timeoutMs` must be a whole number from 1,000 to
86,400,000 milliseconds. `cancelActiveCodexRuns()` cancels all accepted Codex runs
in this application, including runs still starting up, and returns their count. It
stops the managed app-server process so a subsequent run starts a clean one.
`shutdownCodex()` cancels active runs and stops the server; later execution restarts
it. Do not treat these as cleanup
for one mounted component or one request. No per-request AbortSignal is promised for
this backend. Concurrent runs and timeout behavior remain managed by the native
supervisor. Its isolated Codex home uses the user's existing authentication; the
library does not log in or acquire credentials.
The supervisor buffers at most 16 MiB of pre-ack turn notifications; an oversized
buffer fails with an explicit protocol-limit error.

The extraction preserves the existing macOS native supervisor. Transport tests and
native compilation fixtures do not establish real authenticated inference or full
React Native/Nitro host acceptance; those require a rebuilt consuming app.
