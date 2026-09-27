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
  symbol: "tray",
  tooltip: "My app",
  menu: [
    { id: "open", title: "Show app" },
    { separator: true },
    { id: "sync", title: "Sync enabled", checked: true },
  ],
}, event => {
  if (event.itemId === "open") void showWindow();
});
await tray.update({ title: "3" });
await tray.remove();
```

Use a text title, an SF Symbol, or both. Menus support separators, enabled/disabled
and checked items, and nested `items` up to five levels. IDs must be unique within
a menu. A tray without a menu emits `trayClick`; selecting a menu item emits
`trayAction`. Handles serialize updates and dispose their listeners; native bridge
reload also removes its status items. Duplicate tray IDs reject with
`E_TRAY_EXISTS`. An invalid symbol rejects before changing an existing item.

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
`publicKey` into `expo.extra.spark.updates`. Back up the signing key using
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

The release ledger rejects different archive bytes under an existing build
number. Completed packaging retries reuse the exact verified ZIP, including when
feed signing needs to be retried. Keep `dist/updates/` between releases so the feed
retains existing versions. Initial support uses full ZIP updates, without delta
archives, custom channels, or Mac App Store distribution.

## Automated checks

```sh
npm run typecheck
npm test
npm run test:sparkle --       # Real tools, ephemeral test keys; no Keychain mutation
npm run test:integrations --  # prebuilt and custom native APIs; no permission prompt
npm run test:updates --       # Standalone Release startup and menu-bar-only CNG
npm run test:all --           # Also includes the complete SDK/XCTest acceptance suite
```

`test:sparkle` verifies real Ed25519 archive signing, signed-feed generation and
verification, successive releases, retry behavior and conflicting build numbers.
`test:integrations` checks notifications according to current permission: schedules
and cancels a delayed notification when authorized, otherwise verifies refusal to
post; it never prompts or intentionally displays a banner. It also exercises tray
lifecycle/conflicts and the prebuilt/development updater guard. `test:updates` verifies
Sparkle startup from a standalone Release with Metro stopped; it does not install
an update or contact the example feed.

Banner presentation/clicks, tray interaction, and the complete install/relaunch
flow still require an unlocked GUI session and a distribution acceptance run.
Those must not be inferred from API tests or successful feed generation.

Updater preferences use `configureUpdates({ automaticallyChecks?, checkIntervalSeconds? })`; omitted fields stay unchanged. All options are validated before starting/configuring the native updater. `checkForUpdates({ mode: "background" })` starts a background check; the default `"interactive"` uses the native updater UI. Commands resolve void when accepted; use `getUpdateStatus()` to read state and `onUpdateEvent()` for progress. `E_BUSY` reports an active update session, and native failures retain their cause. This is a native macOS application updater, not JavaScript OTA updates. Other targets report unavailable.
