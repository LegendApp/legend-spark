# Notifications, menu bar and updates

These modules target macOS 14+ on Apple Silicon and are included in the SDK/prebuilt
runtime. Import them through separate desktop subpaths; production pruning removes
unused native modules and removes Sparkle when updates are unused.

## Notifications

```ts
import {
  requestNotificationPermission, showNotification, onNotificationResponse,
  dismissNotification,
} from "@legendapp/spark/notifications";

// In an Enable Notifications button handler:
const permission = await requestNotificationPermission();
if (permission.granted) {
  await showNotification({
    id: "export-finished",
    content: {
      title: "Export finished",
      body: "Your document is ready.",
      data: { documentId: "123" },
    },
  });
}
const subscription = await onNotificationResponse(response => {
  // response.notificationId identifies your notification; response.id deduplicates
  // this particular interaction. action is open or dismiss.
  console.log(response.action, response.data.documentId);
});
await dismissNotification("export-finished");
subscription.remove();
```

Response setup is asynchronous while Spark subscribes and replays retained cold-launch responses. Once returned, `remove()` is synchronous; it prevents further callbacks and does not perform asynchronous native cleanup.

`getNotificationPermission()` reads permission without prompting. The result has
`status`, `granted`, and `canAskAgain`; macOS also reports its authorization state,
including provisional access. Unknown ability to prompt is `null`. Windows has no
in-app permission prompt, so requesting permission reads settings and
`canAskAgain` is false. Showing without authorization rejects with
`E_PERMISSION_DENIED`. Availability is separate: `getNotificationAvailability()`
can report unsupported targets or missing modules without prompting or throwing
at import time.

`showNotification({ id, content })` submits immediately.
`scheduleNotification({ id, content, trigger: { type: 'delay', delaySeconds: 60 } })`
schedules delivery; supported delays are one second through ten years. `sound`
defaults to false on both targets. Submission success is OS acceptance, not proof
of presentation. String data and project-scoped IDs are supported.

`cancelNotification(id)` and `cancelAllNotifications()` affect pending delivery.
`dismissNotification(id)` and `dismissAllNotifications()` affect delivered
notifications. Missing IDs succeed. Both families only affect this project's
notifications. OS removal is asynchronous; lists may briefly reflect the prior
state. `getPendingNotifications()` and `getDeliveredNotifications()` return IDs.

The native delegate installs before launch finishes and retains the latest 100
responses for late JS subscribers. Subscriptions deduplicate queued/live overlap.
Foreground notifications can show banners, subject to macOS notification settings
and Focus modes. The Spark Runner shares its host's permission, icon and notification identity;
it can handle responses for its running project, but does not cold-launch the
correct development project from a notification. Test cold launches in a custom
standalone app. No remote push/APNs service is included.

## Tray / menu-bar items

```ts
import { createTray } from "@legendapp/spark/tray";
import { showWindow } from "@legendapp/spark/windows";

const tray = await createTray({
  id: "main",
  title: "My app",
  tooltip: "My app",
  menu: [
    { type: "action", id: "open", label: "Show app" },
    { type: "separator" },
    { type: "checkbox", id: "sync", label: "Sync enabled", checked: true },
  ],
  onAction(event) {
    if (event.type === "action" && event.itemId === "open") void showWindow();
  },
});
await tray.update({ title: "3" });
await tray.remove();
```

On macOS, title is visible status-bar text; optional `macos: { symbol: "tray" }`
adds an SF Symbol. Pass `macos: { symbol: null }` to clear it. On Windows the
application icon identifies the item and title supplies the tooltip fallback;
macOS-only options reject. Menus use the [shared item model](menus.md), supporting
actions, checkboxes, separators and submenus up to five levels. An empty menu emits
`{ type: "click" }`; choosing an item emits `{ type: "action", itemId }`.

Updates snapshot inputs, serialize, and merge with the last successful state.
Arrays replace in full. Removal immediately stops callbacks, waits for accepted
updates, and can retry a native failure. IDs are immutable; duplicate creation
rejects with `E_ALREADY_EXISTS` without removing the existing item. Invalid symbols
reject before changing native state. `getTrayAvailability()` is safe without the
native module installed. Native bridge reload removes its status items.

For an app that starts in the menu bar with no Dock icon or visible main window:

```json
{ "expo": { "extra": { "spark": { "menuBarOnly": true } } } }
```

This requires a custom build. Create the tray from the mounted React root and use
`showWindow()` when the user chooses to open the UI. The hidden root remains
mounted. Avoid configuring menu-bar-only mode without creating a tray or another
way to reopen the app.

## Signed application updates

Updates use [Sparkle 2.9.6](https://sparkle-project.org/documentation/), with its
standard download/install UI, archive verification, installer and relaunch flow.
This updates the whole application, including native code. There is no separate
JavaScript OTA update mechanism.

In the application project:

```sh
npx --no-install spark updates init https://example.com/updates/appcast.xml
```

The command downloads checksum-pinned Sparkle tools, creates or reuses a
project-specific signing key in the login Keychain, and writes only `feedURL` and
`publicKey` into `expo.extra.spark.updates` (re-running it keeps other update fields). Back up the signing key using
Sparkle's documented export/import process; keep private keys out of the repo and
out of the update server. An existing configured key is never silently replaced.

Import and start the updater once your app is ready:

```ts
import {
  startUpdates, getUpdateStatus, checkForUpdates,
  configureUpdates, onUpdateEvent,
} from "@legendapp/spark/updates";

const events = onUpdateEvent(event => console.log(event.state));
const status = await getUpdateStatus();
if (status.available) await startUpdates();

// Check for Updates menu item:
await checkForUpdates();
// User preference toggle (Sparkle persists it):
await configureUpdates({ automaticallyChecks: true });
// Component/application cleanup:
events.remove();
```

`getUpdateStatus()` does not start Sparkle. Spark Runner runtimes and Debug/custom-development builds
report why updating is unavailable; attempts to start/check reject with
`E_UNAVAILABLE`. A configured Release app starts the updater idempotently.
Status remains an async query; its unavailable reason distinguishes `go`, development, and missing release configuration. `configureUpdates({})` starts the configured updater even with no preference fields, while leaving current preferences intact.
Checks initially default off. Explicitly enabling automatic checks preserves the
user's preference on subsequent launches. Installation remains an explicit user
choice. `checkForUpdates()` resolves when the check starts; events describe
checking, availability, download, installation, and errors.

The feed URL must use HTTPS, end in `.xml`, and contain no credentials, query or
fragment. CNG embeds the public key and requires signed feeds and archive
verification before extraction. Feed configuration requires a custom build.
Removing it removes the generated Sparkle configuration on the next prebuild.
Sparkle sends a normal application quit request during installation, allowing the
SDK's existing unsaved-changes guard to defer termination.

To ship an update, increase `expo.macos.buildNumber` for every release and set the
user-visible `expo.version`, then run:

```sh
npm run package
```

The existing package command signs, notarizes and verifies the ZIP. For an app
that imports/configures updates it additionally signs the final ZIP, verifies the
signature against the app's public key, and generates/verifies a signed appcast
under `dist/updates/`. Upload the generated ZIP first, then `appcast.xml`, to the
configured HTTPS directory. The framework does not publish files automatically.

The release ledger requires each new numeric dotted build number to increase
over every recorded release. Comparisons are numeric (`2.10` follows `2.9`),
and alternate spellings of the same number (such as `1` and `1.0`) cannot reuse
one release identity. An exact retry with the same spelling and archive bytes is
allowed, including when feed signing needs to be retried; different bytes under
that number are rejected. Keep `dist/updates/` between releases so the feed
retains existing versions. Custom channels and Mac App Store distribution are not
supported.

### Delta updates

Set `expo.extra.spark.updates.maximumDeltas` (integer 0–10, default 0) to have
`spark package` generate signed Sparkle delta archives to the new build from that
many previous builds retained in `dist/updates/`. Sparkle only uses deltas of the
newest feed item, so each release keeps, references and reports only its own
deltas; older `.delta` files are removed from `dist/updates/` and may be deleted
from the server. Upload the reported `.delta` files with the ZIP before the
appcast. Sparkle downloads the delta whose source is the installed build, with
`downloading` reporting `delta: true`; if that download or its application fails,
Sparkle falls back to the full ZIP and a second `downloading` event reports
`delta: false`.

### Downgrade protection

Downgrades are refused at three layers. Publication rejects any build number not
greater than every recorded build, using Sparkle's numeric ordering. Sparkle only
offers appcast items whose `CFBundleVersion` is newer than the installed one, so a
feed offering only older signed builds reports `notAvailable` to background and
interactive checks. Sparkle's installer also refuses to replace the app with a
lower `CFBundleVersion` (`SUDowngradeError`); Spark's tests do not exercise that
installer path. Spark installs no custom version comparator, so none of these can
be bypassed from JavaScript.

### Skip This Version and check interval

Sparkle's update alert offers **Skip This Version**. The choice emits a `skipped`
event whose `build` (the CFBundleVersion) appears as
`getUpdateStatus().skippedBuild`. If the item was a major upgrade (its
`minimumAutoupdateVersion` is above the installed build) the event has
`major: true` and the build appears as `skippedMajorBuild` instead. Background and
scheduled checks stop offering skipped builds. Interactive `checkForUpdates()`
offers them again and, as Sparkle does for every user-initiated check, clears the
skip choice. `clearSkippedUpdate()` also clears it. Item events carry `version`
(the display version) and `build`.

`configureUpdates({ checkIntervalSeconds })` requires at least
`MINIMUM_UPDATE_CHECK_INTERVAL_SECONDS` (3600): Sparkle silently clamps shorter
Release intervals, so Spark rejects them with `E_INVALID_ARGUMENT`. Status reports
the persisted interval and automatic-check preference before the updater starts
(Sparkle's default interval is 86400 seconds), and `lastCheckedAt` once it has.

## Automated checks

```sh
bun run typecheck
bun run test
bun run test:sparkle       # Real tools, ephemeral test keys; no Keychain mutation
bun run test:integrations  # prebuilt and custom native APIs; no permission prompt
bun run test:updates       # Standalone Release startup and menu-bar-only CNG
bun run test:all           # Also includes the complete SDK/XCTest acceptance suite
```

`test:sparkle` verifies real Ed25519 archive signing, signed-feed generation and
verification, successive releases, signed delta archives for only the newest
build, retry behavior, conflicting and downgraded build numbers, and parity with
Sparkle's version comparator. It then runs a real `SPUUpdater` (headless
`tests/sparkle-updater.m`) against the signed feeds over loopback HTTP, using
Spark's native event and skip-status mapping: delta selection and full-archive
fallback, no offer from an older-only feed, and Skip This Version, skip-major and
clearing. Downloads are redirected to a missing file, so it installs nothing.
`test:integrations` checks notifications according to current permission: schedules
and cancels a delayed notification when authorized, otherwise verifies refusal to
post; it never prompts or intentionally displays a banner. It also exercises tray
lifecycle/conflicts and the prebuilt/development updater guard. `test:updates` verifies
Sparkle startup from a standalone Release with Metro stopped; it does not install
an update or contact the example feed.

Banner presentation/clicks, tray interaction, and the complete install/relaunch
flow still require an unlocked GUI session and a distribution acceptance run.
Those must not be inferred from API tests or successful feed generation.

`getUpdateAvailability()` reports whether this app can self-update (`unsupported-platform` on Windows and other targets, `missing-module`, `go`, `development` or `unconfigured`) without starting Sparkle. Windows is unsupported because Spark's Windows target is development-only, with no release build or distribution packaging ([Windows guide](windows-slice.md)), so there is no installed release to update; Sparkle is macOS-only. Every update command rejects with a typed `SparkError` where unavailable. Updater preferences use `configureUpdates({ automaticallyChecks?, checkIntervalSeconds? })`; omitted fields stay unchanged. All options are validated before starting/configuring the native updater. `checkForUpdates({ mode: "background" })` starts a background check; the default `"interactive"` uses the native updater UI. Commands resolve void when accepted; use `getUpdateStatus()` to read state and `onUpdateEvent()` for progress. `E_BUSY` reports an active update session, and native failures retain their cause. This is a native macOS application updater, not JavaScript OTA updates. Other targets report unavailable.
