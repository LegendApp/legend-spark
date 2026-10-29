# In-app test driver

The release gate drives and screenshots Spark apps from inside the app process. Agents
running the gate have no Screen Recording, Accessibility or input-synthesis (TCC)
permissions by default. The optional pointer backend below requires an Accessibility grant.

The driver (`packages/desktop-app/macos/SparkTestDriver*.mm`, started by the
`@legendapp/spark-desktop-host` app delegate) is compiled into Debug builds of every macOS Spark app,
and into release builds only of apps that opt in ([Builds](#builds)). It is inert unless the gate
runner launches the app with the contract below. Windows has no driver yet.

## Builds

| Build | Driver |
| --- | --- |
| Debug (`spark dev`, `spark build --dev`, the Spark Runner) | Compiled in |
| Release (`spark build`), default | Compiled out: no driver code, no driver commands from other packages |
| Release with `"macos": { "testDriverInRelease": true }` in `desktop.config.json` | Compiled in. The Kitchen Sink sets it, so the gate drives the exact release artifact |

Never set `testDriverInRelease` for an app you distribute. How it works:

- The config plugin writes `ENV['SPARK_TEST_DRIVER_RELEASE'] = '1'` into the generated Podfile when the
  option is set. Every Spark pod that includes `SparkTestDriver.h` (`RNDesktopApp`, `RNDesktopWindows`) sets the
  build setting `SPARK_TEST_DRIVER` to 1 in the Debug configuration, and in other configurations to 1 with that
  variable or 0 without it, and passes it to the preprocessor. `RNDesktopApp` also gives it to the app target, for
  the host's app delegate.
- At 0, `RNDesktopApp` excludes `SparkTestDriver*.mm` from the build (`EXCLUDED_SOURCE_FILE_NAMES`).
  `SparkTestDriver.h` declares `SparkTestDriverStart`, `Active`, `DidMount` and `Ending` as inline no-ops and
  leaves `SparkTestDriverRegisterCommand` undeclared, so code that registers driver commands sits inside
  `#if SPARK_TEST_DRIVER`; outside it, the build fails to compile. A file that includes the header without the
  setting gets the driver declarations, so a release build without the driver fails to link rather than ship
  driver code.
- A build without the driver that is launched with `SPARK_TEST_DRIVER_DIR` logs
  `Spark: this build has no test driver; SPARK_TEST_DRIVER_DIR is ignored` and starts normally.
- After every macOS release build, `spark build` reads the app's code (`Contents/MacOS` and
  `Contents/Frameworks`) for strings only driver code contains: the socket name `driver.sock` and the log
  prefix `Spark test driver:`. Without `testDriverInRelease` it fails if it finds either; with it, it
  fails unless it finds both (`packages/cli/src/release-driver.ts`).

`tests/test-driver-builds.test.ts` checks the configuration, the Podfile line and the podspecs' build
settings. It also compiles a stripped, dead-stripped binary each way and runs the release check on both:
the one without the driver has no driver strings or `SparkTestDriver` symbols, and logs and starts normally
with `SPARK_TEST_DRIVER_DIR` set. It also checks that every `SparkTestDriverRegisterCommand` call outside the
driver's own sources sits after `#if SPARK_TEST_DRIVER`.

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

Flows run through the `driver` runner backend
([docs/e2e-flows.md](e2e-flows.md#the-driver-backend)):
`bun run e2e:run <flow> --backend driver`. It and `ks:capture` share
`scripts/e2e/kitchen-sink.ts`, which resolves the app (a `.app` path, or the last
development build), bundles and serves JavaScript to development builds, and launches
in driver mode. Both use the client in `scripts/e2e/driver.ts`:

```ts
const driver = await launchDriver({ executable, args, env });
await driver.navigate("spark-ks://windows/frame-autosave");
await driver.openFile("/path/to/notes.md");
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

## Focus and window state

By default, a driven app never takes focus from the person using the Mac:

- Activation policy `NSApplicationActivationPolicyProhibited`: no Dock icon, no menu
  bar, cannot activate.
- The main window is created and rendered but never ordered on screen.
- It skips the single-instance lock, so it never signals (and activates) a normal
  instance of the same app.
- App Nap is disabled for the process, so timers and rendering are not throttled.
- Window state is neither restored nor saved, so every driven launch starts at the
  configured window sizes whatever earlier launches (driven or not) left behind: the main
  window's frame autosave, child window bounds (`restoreBounds`), the window manager's
  restorable windows and split-view chrome. AppKit's own restoration recreates no Spark window
  (Spark registers no restoration class). `tests/driver-window-state.native.mm` seeds a
  saved frame and checks a driven main window keeps its size.

Windows that app code opens itself (for example with `@legendapp/spark/windows`) are
still ordered on screen, without activation.

### Real pointer input (macOS)

Run `bun run e2e:run <flow> --backend driver --pointer` to enable `tapOn`. This explicitly
allows the driver to show the target window, change the activation policy from Prohibited
to Regular, and activate the app for foreground clicks. At flow end (including failure),
`restorePointer` hides windows the driver showed, restores their animation behavior and the
activation policy, and reactivates the previously foreground app. Disconnect also restores
this state before quitting. Ordinary driver runs retain the hidden-window behavior above.

The driver waits for mounted UI updates to settle before preparing pointer input, allowing
native gesture recognizers to attach to their views.
The pointer backend resolves `id` selectors through the existing driver, so element lookup
is white-box; the click itself is OS input, posted as Quartz left mouse-down/up events by
a small native helper using `CGEventPostToPid`. It does not invoke a view action or a
JavaScript callback. Modifiers and other gestures are unsupported. The driver translates
its captured-frame coordinates to AppKit window points after showing the window, including
the title bar and Y flip. It constructs and serializes the mouse events in the window-owning
process, where AppKit can resolve the window number and local hit point. The helper decodes
and posts those events to that process without a CGWindow search.
Foreground clicks work with React Native Pressable and gesture-handler targets without
per-view `acceptsFirstMouse` props. Each tap uses one monotonic event number shared by its
down and up events so React Native can pair the press and release.

Grant the e2e runner Accessibility access in System Settings > Privacy & Security >
Accessibility. The helper is compiled once per run and checks `CGPreflightPostEventAccess`
at each flow start, before launching the app;
missing permission fails with `E_PERMISSION_DENIED`, without prompting or waiting for a grant.
Screen Recording permission is unnecessary. Posting events is not proof that a control
handled them; flows must assert the resulting callback or state change.

## Protocol

Newline-delimited JSON. After `{"token": "..."}` (answered `{"ok": true, "protocol": 1}`),
send one request at a time; each reply echoes `id`. Failures are
`{"id", "ok": false, "error": {"code", "message"}}`. `timeoutMs` is optional (maximum 120000).

| Command | Fields | Reply |
| --- | --- | --- |
| `ping` | | `ok` |
| `navigate` | `url`, `timeoutMs` (30000) | Waits for the first rendered UI to settle (so link listeners are subscribed), then opens the URL through `application:openURLs:`, the path the OS uses for deep links. |
| `openFile` | `path`, `timeoutMs` (30000) | `path` must be absolute and exist (`E_INVALID_ARGUMENT`, `E_NOT_FOUND`). Waits like `navigate`, then opens a file URL for it through `application:openURLs:`, the path the OS uses for a file opened from Finder. `navigate` rejects file URLs, so only `openFile` delivers files. |
| `waitFor` | `testID`, `timeoutMs` (10000) | `window` identifier and `frame` of the first visible view whose accessibility identifier (React Native `testID`) matches. `frame` is in points from the top-left of the window's frame view, the area `capture` renders, so frame × `scale` is the view's pixels in a capture. `E_TIMEOUT` otherwise; `timeoutMs: 0` checks once. |
| `setAppAppearance` | `appearance` (`light`/`dark`), `timeoutMs` (10000) | Waits for the first rendered UI to settle (an override set while the app is still launching did not last), then sets `NSApp.appearance` (an app override; the OS setting is untouched; per-window appearances still win). If the effective appearance changed, replies `changed: true` once a UI update has mounted and settled, else `E_TIMEOUT`. `timeoutMs` bounds each wait. |
| `capture` | `window` (`main`, `key`, `id:<identifier>`, `title:<title>`), `name`, `timeoutMs` (5000) | `file`, `width`, `height` (pixels), `scale`, once mounted UI updates have settled. `E_NOT_SETTLED` if they never do. |
| `restorePointer` | | Restores window visibility, animation and app activation state changed by `pointerEvents`. Safe to repeat; also runs on disconnect. |
| `pointerEvents` | `window` (same as `capture`), `x`, `y` (top-left captured-frame points), `timeoutMs` (5000) | Waits for mounted UI updates to settle, shows and activates the window, then returns `pid` and base64-encoded `down`/`up` CGEvent data for that window and point. Explicitly opts out of hidden-window behavior. `E_NOT_SETTLED`, `E_NO_WINDOW`, `E_INVALID_ARGUMENT`, or `E_EVENT` on failure. Posts no input itself. |
| `quit` | | `ok`, then the session ends and the app quits. |

"Settled" means no Fabric mount transaction for 100 ms. The host reports mounts through
`RCTSurfacePresenterObserver`. `main` is the window with identifier `spark.main`. `key`
fails with `E_NO_WINDOW` in driver mode, because an app that never activates has no key window.







| --- | --- |


the table above). Mac App Store review flags private API names found in a binary, even when they are
never called. So these functions compile only with the preprocessor flag
`SPARK_TEST_DRIVER_PRIVATE_EVENTS=1`, in builds that have the driver ([Builds](#builds)):


contains them. `tests/test-driver-builds.test.ts` checks the configuration, the Podfile









| --- | --- |













| --- | --- |






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
