# Editable Mac apps

Spark can ship a normal release app with an opt-in native customization window. The source, Bun/Node tooling, Metro dependencies and Hermes compiler download on first use. Users describe changes in a prompt, review a compiled candidate, and apply it without rebuilding the native app.

This first implementation targets directly distributed macOS apps. Spark's native release builder currently targets Apple Silicon. App Store distribution, Intel native release builds, automatic data migration, and embedded/offline AI models are outside this feature.

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

1. Enter a prompt and choose an HTTPS OpenAI-compatible chat-completions endpoint and model. The first supported provider interface uses tool calls for listing, reading, writing and deleting source files. Provider-specific OAuth or coding-agent subscriptions are not implemented.
2. The API key is stored in macOS Keychain, not source files, patches or manifests. Approve source sharing on the first request to each configured endpoint; subsequent prompts use that choice. Provider usage may incur charges.
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

Checksums and native fingerprints guard against corruption and incompatible bundles. Custom code executes with the app's existing permissions; this is not an untrusted-code sandbox. AI tools cannot change dependencies, native configuration or files outside the candidate workspace.

## Verification

```sh
npm run build:cli
npm run typecheck
npm test
npm run test:editable
```

The opt-in integration test creates real release archives, relocates the toolkit away from the publisher, compiles production Hermes bundles using both Node and Bun, and exercises a deterministic AI editing response. It does not call a paid AI service. The macOS native test compiles the actual host implementation and checks loading, corruption, interrupted activation and original-bundle recovery.
