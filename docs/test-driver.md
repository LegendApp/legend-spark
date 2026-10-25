# In-app test driver

The release gate drives and screenshots Spark apps from inside the app process. Agents
running the gate have no Screen Recording, Accessibility or input-synthesis (TCC)
permissions, so `screencapture`, ScreenCaptureKit, AX and CGEvent are not options.

The driver ships in every macOS Spark app (`packages/desktop-app/macos/SparkTestDriver.mm`,
started by the `@legendapp/spark-desktop-host` app delegate). It is inert unless the gate
runner launches the app with the contract below. Windows has no driver yet.

## Kitchen Sink screenshots

Build the development Kitchen Sink once, and again after native changes:

```sh
cd examples/kitchen-sink && bun run rebuild:macos   # spark build --dev
```

Then capture from the repository root:

```sh
bun run ks:capture <area>/<screen> [--appearance light|dark] [--locale ar] [--out e2e/verification/<N>/]
bun run ks:capture --wait-for infra-shell-root --name catalog-dark --appearance dark   # the launch screen
```

`ks:capture` bundles the current JavaScript (no Metro), launches the app in driver mode,
navigates to `spark-ks://<area>/<screen>`, waits for `<area>-<screen>-root` (or
`--wait-for <testID>`), applies the app appearance (light by default), renders the main
window to `<out>/<name>.png` and quits. The default name is
`<area>-<screen>-<appearance>[-<locale>]` and the default output directory is
`examples/kitchen-sink/.spark/captures`. `--locale` launches with `-AppleLanguages`.

Flows use the client in `scripts/e2e/driver.ts`:

```ts
const driver = await launchDriver({ executable, args, env });
await driver.navigate("spark-ks://windows/frame-autosave");
await driver.waitFor("windows-frame-autosave-root");
await driver.setAppAppearance("dark");
const { file } = await driver.capture("main", "frame-autosave-dark");
await driver.quit();
await driver.close();
```

## Launch contract and security

- `SPARK_TEST_DRIVER_DIR` names a run directory the runner created: absolute, mode
  0700, owned by the user. It holds `token`, a 0600 file of 32-256 bytes. The app
  reads the token, deletes the file, and removes the variable from its environment,
  so child processes never inherit driver mode and nothing can read the token later.
  Any violation exits the app with status 78 and a `Spark test driver:` log line.
- The app listens on `<run directory>/driver.sock` (mode 0600, backlog 1). It accepts
  one connection, from the same user only (`getpeereid`). The first message must carry
  the token, compared in constant time, within 10 seconds. A wrong token ends the session.
- Captures are created only in the run directory, with `O_EXCL | O_NOFOLLOW`, mode
  0600. Names are 1-100 characters of `[A-Za-z0-9_-]`; the runner copies files out.
- One session per launch. When it ends (quit, disconnect or failed authentication),
  the socket is removed and the app quits through `-[NSApp terminate:]`. If no client
  authenticates within 30 seconds, the app quits.
- Accepted sockets are made blocking explicitly and set `SO_NOSIGPIPE`, so partial
  messages are read whole and a client that disconnects cannot kill the app.

## Focus

A driven app never takes focus from the person using the Mac:

- Activation policy `NSApplicationActivationPolicyProhibited`: no Dock icon, no menu
  bar, cannot activate.
- The main window is created and rendered but never ordered on screen.
- It skips the single-instance lock, so it never signals (and activates) a normal
  instance of the same app.
- App Nap is disabled for the process, so timers and rendering are not throttled.

Windows that app code opens itself (for example with `@legendapp/spark/windows`) are
still ordered on screen, without activation.

## Protocol

Newline-delimited JSON. After `{"token": "..."}` (answered `{"ok": true, "protocol": 1}`),
send one request at a time; each reply echoes `id`. Failures are
`{"id", "ok": false, "error": {"code", "message"}}`. `timeoutMs` is optional (maximum 120000).

| Command | Fields | Reply |
| --- | --- | --- |
| `ping` | | `ok` |
| `navigate` | `url`, `timeoutMs` (30000) | Waits for the first rendered UI to settle (so link listeners are subscribed), then opens the URL through `application:openURLs:`, the path the OS uses for deep links. |
| `waitFor` | `testID`, `timeoutMs` (10000) | `window` identifier and `frame` (window coordinates) of the first visible view whose accessibility identifier (React Native `testID`) matches. `E_TIMEOUT` otherwise. |
| `setAppAppearance` | `appearance` (`light`/`dark`), `timeoutMs` (10000) | Sets `NSApp.appearance` (an app override; the OS setting is untouched; per-window appearances still win). If the effective appearance changed, replies `changed: true` once a UI update has mounted and settled, else `E_TIMEOUT`. |
| `capture` | `window` (`main`, `key`, `id:<identifier>`, `title:<title>`), `name`, `timeoutMs` (5000) | `file`, `width`, `height` (pixels), `scale`, once mounted UI updates have settled. `E_NOT_SETTLED` if they never do. |
| `quit` | | `ok`, then the session ends and the app quits. |

"Settled" means no Fabric mount transaction for 100 ms. The host reports mounts through
`RCTSurfacePresenterObserver`. `main` is the window with identifier `spark.main`. `key`
fails with `E_NO_WINDOW` in driver mode, because an app that never activates has no key window.

## What a capture contains

`capture` renders the window's frame view (`contentView.superview`, including the title
bar) with `bitmapImageRepForCachingDisplayInRect:` and `cacheDisplayInRect:`. The PNG is
at the window's backing scale and tagged with its color space (Display P3 on most Macs).

Measured in `tests/test-driver.native.mm`, a window that was never shown:

| Content | Rendered |
| --- | --- |
| Layer background colors (React Native view styles) | Yes, exact color |
| `drawRect:` content (React Native text) | Yes |
| Layer `contents` images | Yes |
| Native controls and labels (`NSButton`, `NSTextField`) | Yes |
| Title bar and traffic lights | Yes, in the inactive style |
| Behind-window vibrancy (`NSVisualEffectView`, `BehindWindow`) | No: a flat material gray, because the blur comes from the window server |
| Window shadow and rounded corners | No: outside the frame view |

`-[CALayer renderInContext:]` on the frame view's or content view's layer was also tried.
For a window that was never shown, it produced an empty, transparent image even after
`[CATransaction flush]`, with no layer colors, drawn content or images. The driver does
not offer it. Content the window server composites, such as behind-window vibrancy,
needs an out-of-process capture, which requires the TCC grant tracked in #50.
