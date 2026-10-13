# Editable Mac apps

Spark can ship a normal release app with an opt-in native customization window. The source, Bun/Node tooling, Metro dependencies and Hermes compiler download on first use. Users describe changes in a prompt, review a compiled candidate, and apply it without rebuilding the native app.

This first implementation targets directly distributed macOS apps. App Store distribution, automatic data migration, and a bundled model engine are outside this feature. Editing toolkits match the architecture and native fingerprint of their release; platform acceptance is recorded in the release support matrix.

## Opt in

In `desktop.config.json`:

```json
{
  "editable": {
    "repository": "your-org/your-app",
    "files": ["package.json", "desktop.config.json", "metro.config.js", "index.ts", "src", "assets"],
    "toolkitRepository": "your-org/spark-toolsets",
    "toolkitTag": "editable-v1"
  }
}
```

Add the application's actual entry/component files, Babel configuration if present, and any other files required to bundle it. Files are an explicit publication allowlist. Hidden files, native project directories, source symlinks and common credential extensions are excluded or rejected. Review the archives before publishing; this is not a secret scanner.

The app source defaults to the GitHub tag `v<app version>`. Set `tag` to override it with another fixed tag. Toolkit hosting defaults to `LegendApp/legend-spark` at `editable-v<Spark version>`; use a repository you can publish to unless the matching toolkit is already available there. Multiple apps with the same resolved toolchain can share the downloaded cache.

Existing Expo projects put this in their desktop overlay. Direct `app.json` projects use `expo.extra.spark.editable`. Additional native APIs available to future edits must be retained using Spark's existing `include` option. The editing worker rejects imports of native modules absent from the release's compatibility manifest.

## Default or custom UI

`editable.ui` defaults to `"default"`: Spark adds **Customize app…** to the Dock menu and **Command–Shift–E**. Set it to `"custom"` to hide those automatic entry points and the update-migration notice. Your app controls the prompt field, styling, placement, confirmations, progress, review and buttons. The native recovery path and Option-at-launch bypass remain available. `showEditor()` can still open the built-in editor from your own button, even in custom mode.

All operations are exported from `@legendapp/spark/editable`, usable from services and event handlers without a mounted React component:

```ts
import {
  configureEditing, generateEdit, getEditingState, onEditingState,
  getEditReview, previewEdit, applyEdit, restoreOriginal,
  prepareEditMigration, cancelEdit, showEditor,
} from '@legendapp/spark/editable';

await configureEditing({ kind: 'cli', tool: 'codex' });

// Subscribe before reading the initial snapshot. Remove at your UI's boundary.
const subscription = onEditingState(state => updateProgress(state));
updateProgress(await getEditingState());

// Explain source sharing and obtain user consent in your own UI first.
const candidate = await generateEdit(promptText, { allowSourceSharing: true });
const review = await getEditReview(); // complete diff, contributing prompts/history
// Render review.text in your own review screen.
await previewEdit(); // session only; reloads the current app and uses current data
await applyEdit();   // call after your own confirmation/save-work flow
subscription.remove();
```

`configureEditing(provider)` saves settings and stores a remote API key in Keychain if supplied. `generateEdit(prompt, options)` can override the provider for that request and saves that choice. Its promise resolves after compilation, with `candidate`, `summary`, `changedFiles`, and `status`. A failure rejects and retains the attempt in history. `getEditingState()` reports availability, busy/phase/message, candidate readiness, active/preview state, migration availability and provider settings without keys. State events are live only; no initial replay is implied.

`prepareEditMigration()` prepares/compiles a three-way merge and returns its candidate/conflicts, or `status: "none"` if there is no earlier customization. To resolve conflicts, call `generateEdit(prompt, { migration: true, allowSourceSharing: true })`. `cancelEdit()` stops owned editing work, retaining partial candidates/history; wait for the current operation to settle before starting another. Mutating operations reject `E_BUSY` while work is in progress. `restoreOriginal()` reloads the embedded app without deleting prompt/source history. Public preview/apply methods do not show Spark's confirmation dialogs: custom UI owns those dialogs and saving app work. Recovery remains native.

## Monorepo source layouts

Set `editable.sourceRoot` to the repository ancestor relative to the app project, for example `"../.."` for `apps/demo`. `files` then selects paths relative to that ancestor, such as `apps/demo`, `shell`, and `packages/shared`. Spark copies the app project's entry and build configuration, preserves repository paths, and relocates literal imports/config paths inside the selected snapshot. Include the app and shell Babel configs and every referenced local build helper. Source paths outside the selected ancestor reject preparation.

The worker runs Metro from the published app project and attaches the frozen toolkit dependencies at the snapshot and project roots. Shared source remains editable; packaged dependencies stay fixed. PR paths preserve the snapshot's directory within the Git repository.

## Submit a customization as a PR

Configure `editable.githubClientId` with a GitHub OAuth app client ID whose device flow is enabled. The target is `editable.repository`; users authenticate with their own GitHub account. Spark requests `public_repo` access and stores the token in the app's macOS Keychain, separate from provider keys. Tokens never enter editing state, history, source, or the AI process.

```ts
import {
  beginEditingGitHubAuth, completeEditingGitHubAuth, signOutEditingGitHub,
  submitEditPullRequest, useEditingState,
} from '@legendapp/spark/editable';

const authorization = await beginEditingGitHubAuth();
// Display authorization.userCode and link authorization.verificationUri.
await completeEditingGitHubAuth(); // cancelEdit() stops waiting
// After the user's explicit Submit action and review of the public prompt/patch:
const pr = await submitEditPullRequest({ title: 'Customize the greeting' });
await signOutEditingGitHub(); // removes the local Keychain token
```

`useEditingState()` observes the same native session used by imperative calls. It returns loading/ready/error state, subscribes before requesting a snapshot, and removes only its observation on unmount. Shared app components can render the prompt, review, progress, provider settings, auth, and submission controls while Spark owns all behavior. The default native editor adds one **Submit as PR** button when a GitHub client ID is configured.

Submission uses the exact compiled candidate, carries all contributing prompts and its cumulative patch, and creates a branch in the user's fork when needed. It preserves other repository files. If affected upstream files changed since the app release, or the prompt/patch exceeds GitHub's PR body limit, submission rejects before writing a branch. GitHub device polling respects its interval, slowdown, and expiration responses. A network failure after publication starts can leave a fork or branch; Spark does not delete user repositories or branches on retry.

## AI providers

Installed **Codex or Claude CLI** tools are supported using their existing login; Spark needs no API key for them. The developer can select a default:

```json
{
  "editable": {
    "repository": "your-org/your-app",
    "files": ["package.json", "desktop.config.json", "metro.config.js", "index.ts", "src"],
    "ui": "custom",
    "provider": { "kind": "cli", "tool": "codex" }
  }
}
```

`tool` can be `"codex"` or `"claude"`; `model` is optional for CLI providers. Users install a recent CLI and sign in through that tool first. Spark looks on the app's PATH plus common macOS user/Homebrew directories. The CLI may contact its cloud service and use account limits; locally running a CLI does not imply offline inference.

The worker uses noninteractive structured output to obtain source-tool calls, feeding each result and compiler diagnostics into subsequent turns. Claude built-in/MCP tools are disabled. Codex uses a strict permission profile granting only system runtime files and its empty per-request directory; command execution, MCP/apps and web search are disabled. Unsupported CLI versions reject the request. See the [Codex permissions reference](https://learn.chatgpt.com/docs/config-file/config-reference). Spark applies requested edits through its existing path/file/config validation rather than permitting agent writes into the installed app. Sessions are ephemeral, while Spark keeps its own prompts/patches. CLI login/install failures reject without activating a candidate. The transport reuses Spark’s shared AI invocation builder, publicly exported from `@legendapp/spark/ai`. The downloaded toolkit includes that same builder and does not depend on the publishing app’s installation.

Keyless local model servers are also supported, using tool-capable OpenAI-compatible chat completions:

```ts
await configureEditing({
  kind: 'local',
  endpoint: 'http://127.0.0.1:11434/v1/chat/completions',
  model: 'your-installed-tool-capable-model',
});
await generateEdit('Make the greeting blue');
```

Local endpoints must use HTTP(S) on `127.0.0.1`, `localhost` (normalized to `127.0.0.1`), or `[::1]`. No authorization header or API key is sent, and requests never follow redirects. The server/model must already be running; Spark does not install an inference engine or download model weights. [Ollama](https://github.com/ollama/ollama/blob/main/docs/api/openai-compatibility.mdx) and [LM Studio](https://lmstudio.ai/docs/developer/openai-compat/tools) document the required compatible interface; actual model/tool support depends on what the user runs.

Remote providers use `{ kind: 'remote', endpoint: 'https://…/v1/chat/completions', model: '…', apiKey: '…' }`. CLI and remote providers require explicit source-sharing consent; loopback providers do not. Published provider configuration never accepts an API key. Provider calls allow up to 30 turns and two compiler repairs; local/CLI requests have a ten-minute per-turn timeout, remote requests two minutes.

## Build and publish

```sh
spark build
spark package
# Create the configured GitHub releases in the distribution repositories first.
spark editable publish
```

A release build writes `.spark/…/editable/` artifacts and embeds `spark-editable.json` in the app before signing. The manifest pins the native fingerprint, source snapshot, toolkit, SHA-256 checksums, compressed sizes and exact GitHub URLs. The source snapshot and toolkit are separate archives. The toolkit preserves installed dependency versions, including nested duplicates and patched packages; users do not run a package installation. Dependency files follow npm publication rules (`files`, `.npmignore`, and `.gitignore` fallback), without running package scripts. Selected credential-like files such as `.env`, private keys and signing certificates reject the build. Linked packages follow these same rules; review their publication configuration before building.

`editable publish` uploads to existing public GitHub releases using the publisher's authenticated `gh`. It verifies existing assets instead of overwriting them. It can be called from release automation after building and creating the releases. Users downloading public assets need neither GitHub accounts nor `gh`.

No uploads happen during `build` or `package`. Upload the pinned assets before distributing the signed app. Do not delete assets while installed app versions depend on them. Dependency/toolkit archives can be large; the manifest reports their actual size and publishing rejects assets at GitHub's 2 GiB limit.

## In the app

Open **Customize app…** in the Dock menu, or press **Command–Shift–E**. The window remains native so broken custom JavaScript cannot disable recovery.

1. Enter a prompt and choose an installed Codex/Claude CLI, a local model server, or an HTTPS OpenAI-compatible remote provider. All providers use the same file tools, compilation, prompt history and review path.
2. Remote API keys are stored in macOS Keychain. CLI and local providers need no Spark API key. Approve source sharing on the first request to each remote endpoint or CLI tool; subsequent prompts use that choice. CLI/remote usage may consume account limits or incur charges.
3. Spark downloads and verifies the toolkit and source. It prefers compatible Bun, falls back to Node, or downloads pinned Bun using Spark's runtime bootstrap.
4. AI edits a separate candidate. The worker runs production Metro transforms and the matching Hermes compiler. On a failed build, it sends the diagnostics back for up to two repair attempts within the request’s 30-step limit. The native shell, dependency versions and app configuration remain fixed.
5. **Review** shows all contributing prompts, the summary and the complete candidate diff against accepted source, including earlier unapplied edits and merged migration changes. **Preview** runs the candidate for the current session; restarting returns to the previously active bundle. **Apply** accepts the candidate and reloads the app. Tools exit after the operation; customized launches use local Hermes bytecode without Metro or an AI connection.

Compilation validates syntax, bundling and native compatibility, not behavior. Preview reloads the current app; it does not launch a second process or clone app data. Changes can affect persistent data. Restoring code does not undo data changes.

## Updates and prompt history

Workspaces live outside the signed bundle under `~/Library/Application Support/<bundle identifier>/SparkEditable/releases/<release hash>`. Each contains the original source (`base`), accepted source (`work`), candidates, compiled bundles, history and the current patch. Follow-up prompts continue the current unapplied candidate. Accepting it retains every contributing prompt, so later migrations can recover the complete intent. Each AI attempt records the exact prompt, base release, provider/model, resulting patch, status and summary or failure. API keys and provider response transcripts are not stored in history.

A new app release uses its embedded bundle until a customization is migrated and accepted. **Migrate edits** prepares a three-way merge from the most recently customized release. Independent changes merge automatically; overlapping or binary changes remain explicit conflicts in a separate migration request. Neither previous source nor previous prompts are overwritten.

Use **Migrate edits** again with a prompt to ask AI to resolve the migration. The request includes previous accepted prompts, patches, upstream changes and conflicts. Accepted intent is carried across successive release migrations. The new candidate must compile with the new release's toolkit and must be explicitly applied. No cloud request or automatic activation occurs merely because an app updates.

The old workspaces remain available if migration fails. This implementation migrates after installing an update; preparing migration before a Sparkle update is installed is not integrated yet.

## Recovery and scope

**Original**, holding **Option** at launch, or launching with `--spark-original` bypasses custom code. Activation records a pending launch before loading custom bytecode. A first React render acknowledges startup; an interrupted first launch rolls back to the previous bundle. A candidate that does not render within 30 seconds restores the embedded original. A first render is a startup check, not a guarantee against later application bugs.

Checksums and native fingerprints guard against corruption and incompatible bundles. Custom code executes with the app's existing permissions; this is not an untrusted-code sandbox. AI tools cannot change dependencies, native configuration or files outside the candidate workspace. Metro, Babel and other build configuration, scripts, local build plugins, and their imported helpers stay fixed. Spark records those trusted files while preparing the signed release and checks them again before running compilation. Build configuration must use static local imports or a fixed config basename; unsupported dynamic loading rejects artifact preparation.

## Local interactive editing test

From the Spark repository on Apple Silicon macOS:

```sh
bun run test:editable:app
```

This builds a small release app, verifies and seeds its source/toolkit archives into the normal download cache, and launches it with a local fake AI provider. No GitHub release, AI account, API key, or paid request is needed. The first run needs the normal native build prerequisites and may download native dependencies. Later runs reuse the build. The fake provider's certificate is trusted only by the launched process and its workers; nothing is installed in your system trust store.

Open **Customize app…** or press **Command–Shift–E**. The endpoint and model are set automatically. Generate “Make the greeting blue”, then “Make the greeting larger”. Review should include both changes. Preview, Apply, quit, and rerun the command to verify persistence. Unsupported prompts produce no edits; this is a deterministic fixture, not a language model. Approve the normal source-sharing dialog when it appears; requests stay on this machine.

Run `bun run test:editable:app --custom-ui` to exercise app-owned prompt, progress, review and activation controls through the public API. **Provider settings** opens the built-in editor, including migration controls. Add `--real-ai` to select an installed Codex/Claude CLI with its existing login; this makes real provider requests.

To test a major update, quit the demo and run:

```sh
bun run test:editable:app --version 2
```

Choose **Migrate edits**, Review, and Apply. The greeting customizations should survive alongside version 2's new footer. **Original** returns to the shipped demo. Quit the app or press Ctrl+C to stop the test server.

Source and native build artifacts remain under `.spark/editable-demo/v1` and `v2`. The test app uses `test.spark.editable-demo`, separate from your apps. Its edits persist in that identifier's Application Support directory so restarts and migrations can be tested. Builds and the shared toolkit cache can use several GB; the command does not delete them or reset previous edits.

Use `--prepare-only` to generate source without building, `--no-open` to build and stage without launching, or `--real-ai` to use your own configured provider instead. No publication occurs in any mode.

## Verification

```sh
bun run build:cli
bun run typecheck
bun run test
bun run test:editable
```

The opt-in integration test creates real release archives, relocates the toolkit away from the publisher, compiles production Hermes bundles using both Node and Bun, and exercises deterministic HTTP and installed-CLI edits. Provider tests cover both CLI contracts on both runtimes, cancellation, failures and keyless loopback requests. They do not call a paid AI service. The macOS native test compiles the actual host implementation and checks the public API, progress, custom/default UI, loading, corruption, interrupted activation and original-bundle recovery.
