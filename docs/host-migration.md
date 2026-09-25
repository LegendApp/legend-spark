# Adopting Spark with an existing macOS host

An existing React Native macOS app can temporarily retain its AppDelegate behavior
while Spark owns the React bootstrap, bundle URL, native dependency graph, and
development session. Add this plugin to the desktop configuration's `expo.plugins`:

```json
[
  ["@legendapp/spark/host-extension", {
    "source": "HostExtension.mm",
    "header": "HostExtension.h"
  }]
]
```

Paths are relative to the consumer project. The header must declare
`AppDelegate : RCTAppDelegate`, and the source must contain exactly one
`@implementation AppDelegate`. Generation creates a `SparkAppDelegate` superclass
and composes the extension as its subclass. Call `super` from
`applicationDidFinishLaunching:`; omit `bundleURL` and `sourceURLForBridge:` so Spark
can load the current development session. Native dependencies imported by the
extension must be installed and included in the app's native selection.

This is an incremental migration API, not a portable lifecycle abstraction.
Overridden methods take precedence over Spark's implementations: quit guards,
reopen behavior, URL handling, and restoration must be validated by the consumer.
Prefer Spark's public window, app, and event APIs for new implementations.

Rebuild after changing the extension. Consumers that generate extension files
should include their content hash in configuration so native compatibility checks
notice changes. Test the debug app before switching existing release workflows.

## Development signing

Debug apps are ad-hoc signed by default. Apps that load same-team native plugins
can set `macOSDevelopmentIdentity` to a certificate name or SHA-1 fingerprint in
their local `.spark/settings.json` (alongside `target: "dev"`), then rebuild.
The identity must already be available in the signing keychain. This setting is
part of the development runtime fingerprint and survives desktop-session updates.
It does not change Runner, preview, release, or distribution signing.

Source-checkout CLI rebuilds preserve unchanged helper files and replace changed
files atomically, allowing multiple app development sessions to run together.
