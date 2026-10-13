# Packaging a macOS app

`spark package` builds a standalone release, signs it with your Developer ID Application identity, submits it to Apple for notarization, staples the ticket, and verifies the final ZIP. It writes the verified archive to `dist/<slug>-<version>-<arch>.zip`, a disk image of the same stapled app to `dist/<slug>-<version>-<arch>.dmg`, and the release's debug symbols next to them as `dist/<slug>-<version>-<arch>-dSYMs.zip`. Keep both for each release: the dSYMs symbolicate its crash reports. Archives store no extended attributes (`ditto --norsrc`), so none of the build machine's, such as `com.apple.provenance`, ship. It does not publish artifacts. Apps configured for updates also get a signed Sparkle feed; see [desktop updates](desktop-integrations.md#signed-application-updates).

In a newly created app:

```sh
npm run package
```

In an existing app that does not yet have the package script:

```sh
npx --no-install spark package
```

`npm run build` continues to produce an ad-hoc-signed standalone app for local testing. Packaging signs a staging copy and leaves that build output untouched.

A standalone build (`spark build`, macOS) also:

- writes `Contents/Resources/ThirdPartyNotices.txt`: every third-party npm package the production JavaScript bundles or the app links natively, and every CocoaPods acknowledgement, each with its license id and license text when the package ships one. First-party packages are left out: `"private": true` packages, and packages inside the app's workspace root (or the app) that are not installed under `node_modules`. A third-party package with neither a license field nor a license file is listed as `License: UNKNOWN` with a build warning (the gate's bundle audit fails on it).
- writes the debug symbols to `dSYMs/` next to the app, never into it: the app's dSYM, a dSYM of the prebuilt Hermes binary made before it is stripped (its symbol table only; React Native publishes no DWARF for it), and the dSYMs vendors ship in their pods (Sparkle). `spark package` archives that folder as the `-dSYMs.zip` next to the distribution ZIP, never inside it.
- removes `NSAllowsLocalNetworking` from `NSAppTransportSecurity` in `Info.plist` (and the dictionary when nothing else is in it). The config plugin sets it so a development build reaches its development server; a standalone build loads its embedded JavaScript.
- compiles C, Objective-C and C++ with `-ffile-prefix-map=<workspace root>=.` and Hermes bytecode from the bundle's file name, so `__FILE__` strings and JavaScript stack traces hold relative paths, not the build machine's.

The release gate's [bundle audit](e2e-flows.md#audits) checks all of this on the built app, and its package audit checks the `spark package` output.

## Disk image

The DMG holds the stapled app and a link to `/Applications`, in a compressed, read-only (UDZO) image named after the app, so a person drags the app into Applications. The image stores no extended attributes of the build machine: `hdiutil makehybrid` writes its HFS+ filesystem itself instead of copying files into a mounted volume, so neither the source's attributes nor the `com.apple.provenance` macOS attaches to every file a tracked process creates reach it, and the Finder info it gives each file (which `codesign --verify --strict` rejects) is cleared on a writable copy, mounted with `-nobrowse`, before the image is compressed. After Apple accepts the app, spark staples it, makes the DMG from it, signs the DMG with the same Developer ID (with a secure timestamp), and notarizes the DMG as its own submission; then it staples a copy and checks its signature, ticket and Gatekeeper's verdict on opening it before it writes the ZIP and the DMG to `dist/`. The release harness's `--local` mode makes its DMG the same way. A Runner package (`spark sdk package-runner`) is only a ZIP.

## Ad-hoc test packages

`spark package --ad-hoc` makes the same package without credentials: it signs the staging copy ad-hoc (hardened runtime, the release entitlements, no timestamp), skips notarization, stapling and the update feed, and writes `dist/ad-hoc/<slug>-<version>-<arch>.zip` with its `-dSYMs.zip` and an unsigned `.dmg` of the ad-hoc app. Use it to check the package layout locally; Gatekeeper rejects it as a download, so it is never a release.

## First-run setup

Install a Developer ID Application certificate and its private key through Xcode or Keychain Access. Packaging requires macOS, the native build prerequisites, and access to Apple's notarization service. Mac App Store signing and submission are not implemented; `spark build --sandbox` makes the App Sandbox variant a Mac App Store build starts from, signed ad hoc for local testing ([App Sandbox variant](app-sandbox.md)).

Interactive setup first lists available matching Developer ID signing certificates for selection, even when only one matches. It then lists saved notarization Keychain profiles, with separate options to enter an existing profile name or create one using Apple's interactive `notarytool store-credentials` command. Creation requires explicitly selecting the create option; pressing Enter never selects it. A signing certificate name is not automatically a notarization profile. If a profile is missing, spark returns to those options. Apple's tool handles secret input directly; spark does not capture it. Credentials are validated before a native build begins. Noninteractive runs still select the only matching certificate automatically and require an existing notarization profile.

Interactive selection keeps the remembered certificate as the default while
showing other available certificates. Explicit identity and team selectors still
filter the list.

Profile discovery uses Apple's Security framework to read
[profile name attributes](https://developer.apple.com/documentation/security/item-return-result-keys),
without requesting password data. It searches local Keychains and synchronized
profiles, or only `SPARK_SIGNING_KEYCHAIN` when specified. A discovery error stops
setup so an inaccessible Keychain is not presented as an empty list. Xcode's Swift
tool is used for this metadata query; no extra package is installed.

Repeat or change the setup with:

```sh
npx --no-install spark credentials
```

spark remembers the certificate fingerprint, team, and Keychain profile in `.spark/signing.json`. This file contains references, not private keys or passwords, and is ignored by Git. Secret values do not belong in `app.json`.

## CI and explicit credential selection

The same package command works without prompts when credentials are already installed and selected:

- `SPARK_DEVELOPER_ID_APPLICATION`: certificate fingerprint or full Developer ID Application identity name.
- `SPARK_TEAM_ID`: optional team filter.
- `SPARK_NOTARY_KEYCHAIN_PROFILE`: existing, validated notarization profile name.
- `SPARK_SIGNING_KEYCHAIN`: optional path to a keychain containing both the signing identity and notarization profile.

CI should import its signing identity into a temporary keychain and populate a notarization profile using Apple's tools. spark does not export certificates or store raw secrets in project files. Its command runner redacts password/token arguments and explicitly marked sensitive values from command logs, output, and errors.

Optional non-secret identity selectors can also be declared under `expo.extra.spark.signing.macos.identity` and `.teamId`. Environment variables take precedence over project selectors and remembered choices.

## Entitlements and native modules

Declare app capabilities in `expo.macos.entitlements`:

```json
{
  "expo": {
    "macos": {
      "entitlements": {
        "com.apple.security.network.client": true
      }
    }
  }
}
```

Native packages may declare requirements in their `package.json` under `spark.entitlements.macos`. CNG combines these requirements with the app's declarations. Arrays are combined; conflicting scalar requirements fail rather than silently dropping a requirement.

The framework owns the generated entitlements file. It does not inherit the desktop template's sandbox defaults. Custom config plugins should express entitlement requirements through the same app declarations or native-package metadata. Capabilities requiring provisioning-profile generation/embedding are not implemented by this packaging command.

Packaging resolves requirements from the release binary's actual native module set. An unused SDK module cannot contribute entitlements merely because it was present in an earlier development build. Development-only `get-task-allow` privileges and unresolved Xcode variables are rejected for distribution. Electron-specific JIT or library-validation exceptions are not enabled by default.

For an embedded helper process, declare an exact bundle-relative target under `expo.extra.spark.signing.macos.entitlementsByPath`, for example:

```json
{
  "Contents/Helpers/Worker.app": {
    "com.apple.security.app-sandbox": true
  }
}
```

Unknown targets fail. Helpers use their own entitlements; libraries receive no process entitlements. Configure a helper's bundle instead of conflicting overrides on its main executable.

## Notarization and retries

The command saves the signed upload and submission ID under `.spark/packaging/`, and after the app is accepted, the signed DMG and its submission ID. It polls Apple for up to two minutes per submission. If processing is still pending, it exits with code **2** and prints instructions to run `spark package` again. Unchanged inputs reuse the build and submission. A successful completed package exits with code **0**; failures exit with code **1**.

If Apple rejects the app, spark saves the notarization log and reports its path. Fix the reported issue and package a new build. Repeating an unchanged rejected submission does not upload it again.

If a connection drops before Apple returns the submission ID, spark records the uncertainty and will not submit the same artifact again automatically. Find the ID with `notarytool history`, then recover it with:

```sh
npx --no-install spark package --submission-id <submission-id>
```

Until Apple accepts the app, `--submission-id` recovers the app's submission; after that, the DMG's (its upload is `<slug>-<version>-<arch>-<key>.dmg`). Recovery checks the unique upload filename, and acceptance checks Apple's recorded SHA-256 against the exact uploaded ZIP or DMG. Keep the `.spark/packaging/` artifacts while a submission is pending. A changed staged artifact is rejected.

After acceptance, spark staples a fresh final copy. The original signed upload stays immutable so an interrupted staple or validation can be retried safely; so does the signed DMG, and a changed staged ZIP or DMG is rejected. Final validation checks bundle metadata, the selected binary architecture, nested Developer ID signatures, signing team, hardened runtime, secure timestamps, exact entitlements, stapling, and Gatekeeper. The ZIP is extracted and validated again before it appears in `dist/`.

## Validation status

The orchestration is covered by simulated signing/notarization tests for pending, accepted, rejected, interrupted, and tampered-artifact cases. Signing order was also exercised with real Apple tools and ad-hoc signing on a copy of the local Hello World app. Generated entitlements were checked through a real expo-desktop prebuild. `spark package --ad-hoc` was run on the Kitchen Sink, and the gate's package audit passed on its output, including its DMG's layout, except the Developer ID and notarization checks of the app and the DMG.

A real Developer ID-signed, notarized distribution has not yet been submitted or validated. That acceptance check requires an explicitly selected signing identity and notarization profile. Public prebuilt distribution, provisioning profiles, Sparkle update signing, and publishing remain separate work.

See [Intel macOS targets](macos-intel.md) for architecture selection and dual-architecture Runner releases.
