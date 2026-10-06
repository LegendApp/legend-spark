# Transferable SDK and prebuilt development clients

A developer can install this SDK without the framework checkout. The distribution is a directory containing immutable package archives, a manifest, SHA-256 checksums, an installer, and optionally Spark Runner runtimes. Public npm publication and a hosted download service are not required for internal testing.

## Produce a bundle

```sh
bun run pack:local
bun run spark sdk build-runner
bun run spark sdk export /path/to/SparkSDK \
  --runtime /path/to/SparkRunner.app
```

On Windows, build the Spark Runner with `spark sdk build-runner --platform windows`, then pass its entire `SparkWindows` product directory to `sdk export --runtime`. Keep all DLLs beside `MyApp.exe`. The runtime option can repeat to include clients for both platforms. Exports refuse to overwrite existing output and publish the destination only after checksums and metadata pass.

The maintained prebuilt profile includes `/ui`, Clipboard, SecureStore, Linking, and file dialogs. On macOS it also contains the broader desktop starter SDK and Expo JSON utilities used in universal development dependency graphs. Explicit `sdk build-runner --project ...` builds preserve the supplied project’s chosen module set.

The SDK uses the existing pinned Expo Desktop beta matrix. Package dependencies and overrides are resolved to paths on the recipient machine immediately before Expo Desktop creates the application. Packed templates contain no producer-machine absolute paths. The source checkout's local development workflow continues to work.

## Install on another machine

Transfer the directory while preserving file contents, executable permissions, and symlinks. On macOS, archive it with `ditto -c -k --sequesterRsrc --keepParent SparkSDK SparkSDK.zip`; extract before installing. Download and transfer through your existing trusted internal channel.

With Node 24.19.0+ and npm, pnpm, Yarn, or Bun installed:

```sh
cd /path/to/SparkSDK
node install.mjs
# The installer prints the exact installed CLI command:
node .cli/node_modules/@legendapp/spark/bin/spark.cjs create /path/to/MyApp --universal
# Or create the complete example:
node .cli/node_modules/@legendapp/spark/bin/spark.cjs create /path/to/MyEditor --example document-editor
```

The installer verifies package/client contents before installing its isolated CLI and registering the SDK and Spark Runner runtimes. It still needs network access for pinned third-party npm dependencies. Checksums detect corruption; they are not a publisher signature.

Keep the installed SDK directory in place: applications reference its immutable archives, and the prebuilt registry references its clients. It can be relocated **before installation**. After moving an installed SDK, rerun its installer and refresh application package paths before installing dependencies again. This is a portable internal distribution, not yet registry-independent project manifests or an automatic SDK updater.

Inside the app, `npm run macos` or `npm run windows` discovers a matching registered Spark Runner. The existing compatibility gate rejects a client with different native signatures. Installing new native dependencies still requires a development build and the native toolchain. Mobile native builds remain Expo workflows.

Prebuilt clients are development executables, not signed production releases. A Windows client must be produced on Windows; macOS cannot cross-compile it. Windows clean-machine startup and redistribution remain explicit acceptance items.

## Recorded checks

A freshly exported SDK was moved to a different directory, installed under a separate spark registry, and used to create an app outside the checkout. Its dependencies point exclusively to the recipient SDK. Unit tests cover relocation, altered archives, and escaping symlinks. A current macOS Spark Runner was built, exported, registered from the transferred SDK, and used to launch the recipient app in Hermes without a native build. The installed SDK also created the complete document-editor example, whose consumer TypeScript check passed.

## Public package layout

Spark ships as one public npm package, `@legendapp/spark`. Applications import
subpaths such as `@legendapp/spark/ui`, `@legendapp/spark/clipboard`, and
`@legendapp/spark/files`. Configuration helpers are exported at
`@legendapp/spark/config`, `@legendapp/spark/config-plugin`,
`@legendapp/spark/expo-config`, `@legendapp/spark/metro`,
`@legendapp/spark/metro` and `@legendapp/spark/native`. The package owns the `spark` executable.

`bun run pack:local` builds the publishable `legendapp-spark-*.tgz` archive in
`artifacts/packages`; its filename is recorded under `@legendapp/spark` in
`manifest.json`. Release automation must publish that archive, rather than
running npm publish directly in a source package directory. This command builds
and registers local artifacts; it does not publish them.

The archive bundles the private implementation modules, including the CLI,
configuration plugin, and native sources. Their private package identities remain
available to codegen, autolinking, and production pruning; they are not separate
public dependencies to install. Internal source packages are marked private.
SDK manifests also retain patched third-party archives and test fixtures.

Changing the packed native metadata changes compatibility signatures. Rebuild
Spark Runner from the matching SDK before testing an application with this layout.
The CLI ships compiled JavaScript and runs on Node 24.19.0+. Bun is optional.
Creation accepts `--package-manager npm|pnpm|yarn|bun`; existing projects use their
`packageManager` field or lockfile. The calling package manager is preferred for
new projects, with npm as the fallback. SDK installers accept the same flag.
