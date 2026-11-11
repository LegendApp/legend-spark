# AI tools and app customization

Exports: `@legendapp/spark/ai`, `/ai/codex`, `/customize`.

## Running Claude/Codex CLIs (`/ai`, `/ai/codex`)

- `/ai` runs the user's installed `claude` or `codex` command-line tools through Spark processes. Installing and logging in is the user's job; check `getAICommandAvailability()` first and explain what is missing.
- Availability is advisory and never runs a prompt. Results are untrusted text: use `parseAIJson` / `extractJsonCandidate` and validate the shape yourself.
- `/ai/codex` talks to Codex directly (`runCodexPrompt`, `cancelActiveCodexRuns`, `shutdownCodex`); call `shutdownCodex()` on app teardown. Prefer it over `runAITool({ tool: 'codex' })` when you need Codex-specific options (`developerInstructions`, `outputSchema`, `reasoningEffort`) or the thread/turn IDs; `runAITool` is a one-shot CLI call that works with either tool.
- `/ai` needs Spark processes (macOS, Windows dev builds); availability reports both tools missing elsewhere. `/ai/codex` is macOS only (`E_UNSUPPORTED_PLATFORM` elsewhere). Neither runs on mobile/web.

```ts
import { getAICommandAvailability, parseAIJson, runAITool } from '@legendapp/spark/ai';

const availability = await getAICommandAvailability({ preferredTool: 'codex' });
if (availability.preferredTool) {
  const result = await runAITool({ tool: availability.preferredTool, prompt: 'Return a JSON object containing a greeting.' });
  console.log(parseAIJson(result.output));
}
```

`result.output` is decoded stdout (or stderr when stdout is empty); `result.exit` reports the exit status.

## In-app customization (`/customize`)

Opt-in feature for directly distributed macOS apps: users describe a change, review a compiled candidate and apply it without a native rebuild. Configure `customize.repository` in `desktop.config.json`; the toolkit downloads on first use. Workspaces live under `~/Library/Application Support/<bundle id>/SparkCustomize/`. Not for the App Store; no automatic data migration. Use `showEditor()` to open the UI and `useCustomizeState` / `getCustomizeState` to reflect status. For providers, a custom UI, monorepos and PR submission, read `docs/customize-apps.md` in the Spark repository.

The minimum is a GitHub repository whose tag `v<app version>` holds the released source, plus an explicit list of source paths (no hidden files, `node_modules` or native projects):

```json
{ "customize": { "repository": "your-org/your-app", "files": ["package.json", "desktop.config.json", "metro.config.js", "index.ts", "src", "assets"] } }
```

```ts
import { showEditor } from '@legendapp/spark/customize';

// From a menu item such as "Customize…":
await showEditor();
```
