# In-app test driver

The release gate drives and screenshots Spark apps from inside the app process. Agents
running the gate have no Screen Recording, Accessibility or input-synthesis (TCC)
permissions, so `screencapture`, ScreenCaptureKit, AX and CGEvent are not options.

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
  option is set. Every Spark pod that includes `SparkTestDriver.h` (`RNDesktopApp`, `RNSparkUI`,
  `RNSparkMotion`, `RNDesktopSystem`, `RNDesktopWindows`, `RNDesktopClipboard`, `RNDesktopDrag`, `RNDesktopPermissions`, `RNDesktopBiometrics`, `RNDesktopSharing`, `RNDesktopLinks`, `RNDesktopGlobalShortcuts`), and `RNDesktopDiagnostics`, sets the build setting
  `SPARK_TEST_DRIVER` to 1 in the Debug configuration, and in other configurations to 1 with that variable or 0
  without it, and passes it to the preprocessor. `RNDesktopApp` also gives it to the app target, for the host's
  app delegate.
- At 0, `RNDesktopApp` excludes `SparkTestDriver*.mm` from the build (`EXCLUDED_SOURCE_FILE_NAMES`): the
  driver, its commit watching and accessibility audit, and the `state` and `listeners` commands.
  `SparkTestDriver.h` declares `SparkTestDriverStart`, `Active`, `DidMount` and `Ending` as inline no-ops and
  leaves the hooks for other modules undeclared. Code that registers driver commands
  (`SparkTestDriverRegisterCommand` and the other hooks) sits inside `#if SPARK_TEST_DRIVER`; outside it, the
  build fails to compile. So does code that serves only the driver: motion's virtual clock and telemetry,
  `simulateSystemEvent`'s appearance overrides, the host's `replyDriverState` operation (the `exposeTestState`
  answer), and diagnostics' native simulated crashes (the `SPARK_SIMULATE_CRASH` launch hook; `simulateCrash`
  rejects native kinds with `E_UNAVAILABLE` without it) and simulated hangs (`simulateHang` rejects `E_UNAVAILABLE`
  without it). A file that includes the header without the setting
  gets the driver declarations, so a release build without the driver fails to link rather than ship driver
  code.
- A build without the driver that is launched with `SPARK_TEST_DRIVER_DIR` logs
  `Spark: this build has no test driver; SPARK_TEST_DRIVER_DIR is ignored` and starts normally.
- After every macOS release build, `spark build` reads the app's code (`Contents/MacOS` and
  `Contents/Frameworks`) for strings only driver code contains: the socket name `driver.sock`, the log
  prefix `Spark test driver:`, the commands `startCommits`, `accessibilityAudit`, `simulateSystemEvent`,
  `simulateDisplays`, `simulateGlobalShortcut`, `setTestClipboard`, `testDrag`, `advanceClock` and `waitForMotion`, the `driverListeners` request and `replyDriverState`
  operation, and `SPARK_SIMULATE_CRASH`. Without `testDriverInRelease` it fails if it finds any; with it, it
  fails unless it finds the socket name and log prefix (`packages/cli/src/release-driver.ts`).

`tests/test-driver-builds.test.ts` checks the configuration, the Podfile lines and every podspec's build
settings. It also compiles a stripped, dead-stripped binary each way and runs the release check on both:
the one without the driver has no driver strings or `SparkTestDriver` symbols, logs and starts normally
with `SPARK_TEST_DRIVER_DIR` set, ignores `SPARK_SIMULATE_CRASH`, has `SparkSimulateCrash` fail
`E_UNAVAILABLE` and `SparkSimulateHang` return without blocking; the one with the driver blocks. It also checks that every `SparkTestDriverRegisterCommand` call outside the excluded
sources sits after `#if SPARK_TEST_DRIVER`.

## Kitchen Sink screenshots

Build the development Kitchen Sink once, and again after native changes:

```sh
cd examples/kitchen-sink && bun run rebuild:macos   # spark build --dev
```

Then capture from the repository root:

```sh
bun run ks:capture <area>/<screen> [--appearance light|dark] [--locale ar] [--out e2e/verification/<N>/] [--dev-bundle]
bun run ks:capture --wait-for infra-shell-root --name catalog-dark --appearance dark   # the launch screen
```

`ks:capture` bundles the current JavaScript (no Metro), launches the app in driver mode,
navigates to `spark-ks://<area>/<screen>`, waits for `<area>-<screen>-root` (or
`--wait-for <testID>`), applies the app appearance (light by default), renders the main
window to `<out>/<name>.png` and quits. The default name is
`<area>-<screen>-<appearance>[-<locale>]` and the default output directory is
`examples/kitchen-sink/.spark/captures`. `--locale` launches with `-AppleLanguages`. The JavaScript is built without `__DEV__`, like a release
bundle; `--dev-bundle` serves a development bundle instead, to capture development-only UI. `--dev-server
http://127.0.0.1:<port>` loads development JavaScript from a running `spark dev` instead, with its inspector proxy,
for screens that need it, such as React Native DevTools ([devtools.md](devtools.md)).

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

## Pinned host settings

AppKit draws some pixels from the Mac's settings, so the same build could capture differently
at another time of day or on another Mac. `KitchenSinkApp.launch` (`scripts/e2e/kitchen-sink.ts`),
which the driver backend and `ks:capture` share, passes the settings below as launch arguments.
Launch arguments go into the app's argument domain (`NSArgumentDomain`): they apply to that one
process and never change the user's or the system's settings. They come before the locale and
the flow's own `arguments`, so a flow can override one (the last value wins).

Measured on macOS 27 (26A428), with a small AppKit app that renders a never-shown window the
way `capture` does, and with Kitchen Sink captures (the system appearance, tinting, contrast and
transparency rows):

| Argument | Pins | Evidence that AppKit reads it |
| --- | --- | --- |
| `-NSRequiresAquaSystemAppearance YES` | The system appearance the app sees: light. With Appearance set to Auto, the system turns dark at sunset. A dark app's inactive title text ("KitchenSink") then renders gray 135 instead of 151, so every dark golden recorded at night failed in the morning (#283). `setAppAppearance` still applies light and dark to the app. | With AppKit's in-process system appearance testing override set to dark (an experiment, not shipped), a capture differs from one under a light system in 1875 title-text pixels. With this argument, the two are identical. |
| `-AppleReduceDesktopTinting YES` | Wallpaper tinting off. | `+[NSApplication isReduceDesktopTintingEnabled]` returns YES. Captures with tinting on and off were identical: the driven window is never on screen, so the window server has no wallpaper behind it to tint from. |
| `-AppleAccentColor 4` | Blue accent colour. It also replaces an app's own accent colour. | `0` makes `controlAccentColor` red. |
| `-AppleHighlightColor "0.698039 0.843137 1.000000 Blue"` | Blue text selection. | An orange value changes `selectedTextBackgroundColor`. |
| `-increaseContrast NO` | Increase contrast off. | `YES` turns on `accessibilityDisplayShouldIncreaseContrast` and changes title text, labels and controls. |
| `-reduceTransparency NO` | Reduce transparency off. | `YES` turns on `accessibilityDisplayShouldReduceTransparency` and turns the title bar from gray 70 to 30. |
| `-differentiateWithoutColor NO` | Differentiate without colour off. | `YES` turns on `accessibilityDisplayShouldDifferentiateWithoutColor`. |
| `-AppleShowScrollBars WhenScrolling` | Overlay scroll bars. Automatic would show legacy scroll bars while a mouse is connected. | `Always` makes `NSScroller.preferredScrollerStyle` legacy. |
| `-AppleFontSmoothing 2` | Font smoothing on. | `0` changes text pixels; `1`, `2` and `3` render like the default. |

Not pinned this way:

- `AppleInterfaceStyle` and `AppleInterfaceStyleSwitchesAutomatically` have no effect in the
  argument domain. `NSRequiresAquaSystemAppearance` pins the system appearance instead.
- The display's colour space and backing scale, fonts and the macOS version depend on the Mac
  ([Determinism](e2e-flows.md#determinism)).

No capture needs a mask for host settings: every difference measured is pinned above.
`tests/e2e-kitchen-sink-launch.test.ts` launches a fake app and checks its arguments.

## App state

`e2e:run`, `ks:capture` and `scripts/test-devtools.ts` never launch the app itself: each driver session (one flow,
one `ks:capture`) launches a clone with its own bundle and project identifiers (`<bundle id>.driver`, which is also
the app id the clone reports to React Native DevTools), home, and temporary directories, deleted when the session
ends. These runs, `clearState` included, work while a developer runs the same app and never touch that instance's
data. The release gate drives the release artifact itself with its real state, and refuses while another instance
of the app runs ([docs/e2e-flows.md](e2e-flows.md#app-state)).

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

A driven app never takes focus from the person using the Mac:

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
- Windows that app code opens or shows with `@legendapp/spark/windows` are never ordered on
  screen either. They are created, sized, styled and rendered as usual, and the window API
  reports them as the app left them: `visible` is true after opening or `showWindow` and false
  after `hideWindow`, with the matching `visibilityChanged` events. Capture them with
  `capture` and `id:<window id>`.
- Consequences: no window is ever key, so `focused` stays false. A modal window is not
  attached to its parent as a sheet, so a second modal window does not reject `E_BUSY`.
  Native fullscreen (`setWindowFullscreen`, and the legacy fullscreen opening) needs an
  on-screen window and rejects `E_UNSUPPORTED_OPTION`. Options whose effect only the window
  server shows (level, Spaces, content protection, click-through, opacity, shadow,
  behind-window vibrancy) are applied to the `NSWindow` but cannot be seen in a capture.
- Window tabs are real AppKit tab groups, regrouped without ordering anything on screen: AppKit's
  automatic tabbing on show never runs, `moveTabToNewWindow` and `mergeAllWindows` use the tab group's
  own add and remove, and the driver records which tab is selected, because selecting a tab orders it
  on screen ([window tabs](api-window-contract.md#window-tabs)).
- The shared color and font panels and the eyedropper would reach the screen (the eyedropper
  takes over the real pointer), so `showColorPanel`, `showFontPanel` and `sampleScreenColor`
  reject with `E_UNAVAILABLE`, and an activated `ColorWell` reports `E_UNAVAILABLE` through
  `onError` without showing the panel.

`tests/window.native.mm` checks that windows opened, shown, hidden, made modal and tabbed in driver
mode are never on screen (`NSWindow.visible` and the window server's on-screen flag) while the
window API reports them as shown.

The one exception is pointer input ([Input](#input)): for the duration of a pointer
command, the driver orders its target window in, fully transparent, ignoring real mouse
events, behind every other window, never key or main, and orders it out again when the
command ends.

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
| `elements` | | `windows` (`id`, `title`, `key`, `main`, `frame`), front to back, and `elements`: the in-process accessibility view of every window with an identifier. An element is a visible view with a testID, or an accessibility element (controls through their cells) with a role, label or text: `key`, `parent` (the key of the nearest enclosing element), `window`, `id`, `role` (the NSAccessibility role without `AX`: `button`, `staticText`, `radioButton`), `label`, `text` (the string value, else the title, else the displayed text of a view with attributed text, such as React Native `Text`), `value` (the accessibility value as a string, numbers included), `enabled` and `selected` (its `isAccessibilityEnabled` and `isAccessibilitySelected`, a control's through its cell) and `frame` (as `waitFor`). A view inside an element with the same testID (the native control a React Native view hosts) refines that element. The components of an `NSPathControl` and the tab buttons of an `NSTabView` (accessibility elements that are not views) are elements too. A window's `frame` is its frame view, at 0,0. |
| `setAppAppearance` | `appearance` (`light`/`dark`), `timeoutMs` (10000) | Waits for the first rendered UI to settle (an override set while the app is still launching did not last), then sets `NSApp.appearance` (an app override; the OS setting is untouched; per-window appearances still win). If the effective appearance changed, replies `changed: true` once a UI update has mounted and settled, else `E_TIMEOUT`. `timeoutMs` bounds each wait. |
| `capture` | `window` (`main`, `key`, `id:<identifier>`, `title:<title>`), `name`, `timeoutMs` (5000) | `file`, `width`, `height` (pixels), `scale`, once mounted UI updates have settled. `E_NOT_SETTLED` if they never do. |
| `tap` | target, `button` (`left`/`right`/`back`/`forward`), `clickCount` (1-3), `modifiers` | Moves the driver's pointer to the target, then presses and releases `clickCount` times. `back` and `forward` are mouse buttons 3 and 4 (other-mouse events; they need [private event functions](#private-event-functions)). |
| `hover` | target | Moves the driver's pointer to the target. |
| `drag` | `from`, `to` (targets in one window), `window`, `steps` (10, 1-500), `modifiers` | Presses at `from`, moves to `to` in `steps` dragged events, releases. |
| `scroll` | target, `deltaX`, `deltaY`, `precise` (false), `modifiers` | One scroll wheel event over the target. Deltas are positive toward the end of the content (down, right): points when `precise`, else lines. |
| `gesture` | target, `kind`, `modifiers` (needs [private event functions](#private-event-functions)); `magnification` (`magnify`), `rotation` (`rotate`), `steps` (10, 1-100), `direction` (`swipe`), `stage` (`pressure`: 1 or 2, default 2) | A trackpad gesture over the target, after moving the driver's pointer there. `magnify` and `rotate` send a began event, `steps` changed events of equal parts of the total (`magnification` is a scale change greater than −1; `rotation` is AppKit's: degrees, counterclockwise positive), and an ended event. `swipe` (`left`, `right`, `up`, `down`) and `smartMagnify` are single events. `pressure` is a click whose pressure rises through stage 1 and, for stage 2, into a force click, then falls before the release. |
| `cursor` | target (optional) | `cursor` and `hiddenUntilMoved`: the cursor AppKit would show over the target, else at the driver's pointer ([Cursor](#cursor)). The pointer does not move. |
| `pressKey` | `key`, `modifiers`, `window` | One key press. `key` is one character: a character key, or AppKit's character for a function key (`"\r"` Return, `"\u001b"` Escape, `"\u007f"` Delete, `"\uf700"` Up arrow, `"\uf704"` F1). |
| `typeText` | `text`, `window` | One key press per user-perceived character, any Unicode (no input method). A newline presses Return. |
| `menus` | | `menus`: the application menu bar (`NSApp.mainMenu`) as a tree, after `-[NSMenu update]` validates it, so `enabled` and `state` are what a user opening the menu sees. Items have `title`, `id`, `enabled`, `hidden`, `state` (`on`/`off`/`mixed`), optional `shortcut` (`key`, `modifiers` as NSEventModifierFlags bits), `toolTip`, `alternate` and `items`; separators are `{ "separator": true }`. The system Services menu is not expanded. A driven app shows no menu bar, but it has one. |
| `accessibilityAudit` | `scope` (`window`: the main window, `app`: every window with an identifier), `name`, `timeoutMs` (5000) | `windows`, `captures` and `elements`, once mounted UI updates have settled: the facts of an [accessibility audit](#accessibility-audit). |
| `startFrames` | `timeline` | `refreshRate`. Starts counting frames ([Frame timing](#frame-timing)); with `timeline: true` it also records the frame timeline, polling the animating MotionViews each frame. `E_BUSY` while counting, `E_UNAVAILABLE` without a display. |
| `stopFrames` | | `frames`, `droppedFrames`, `maxFrameGapMs`, `durationMs`, `fps`, `refreshRate` since `startFrames`, and when it started with `timeline: true` the frame timeline: `timestamps` (each frame, ms from the start), `intervalMs`, `motion` (`{view, startMs, endMs}`) and `truncated` ([Frame timing](#frame-timing)). `E_INVALID_STATE` without `startFrames`; `E_UNAVAILABLE` when the display link delivered fewer than two frames. |
| `startup` | `testID`, `timeoutMs` (30000) | `phases`: milliseconds from the kernel's start of the process to each startup phase ([Startup phases](#startup-phases)), once the first rendered UI has settled and, with `testID`, that element has shown at a quiet point. `E_TIMEOUT` before that; `E_UNAVAILABLE` when the kernel does not report the start time. |
| `state` | `path`, `timeoutMs` (5000) | `value`: the JSON value at `path` of the state the app's JavaScript exposes ([Exposed state](#exposed-state)). The app's errors pass through (`E_NOT_FOUND` for a name or key it does not have); `E_TIMEOUT` when no JavaScript answers. |
| `startCommits` | | Starts watching the main run loop's commits ([Layout thrash and flicker](#layout-thrash-and-flicker)). `E_BUSY` while watching. |
| `stopCommits` | `timeoutMs` (5000) | Once mounted UI updates have settled: `commits`, `relayouts` (`view`, `window`, `changes`, `frames`), `gaps` (`id`, `window`, `commits`) and `blanks` (`window`, `commits`) since `startCommits`. `E_INVALID_STATE` without `startCommits`; `E_NOT_SETTLED` if the UI never settles (watching ends either way). |
| `counters` | `timeoutMs` (5000) | Once mounted UI updates have settled: `windows`, `views` and `fileDescriptors` ([Leak counters](#leak-counters)). `E_NOT_SETTLED` otherwise. |
| `listeners` | `timeoutMs` (5000) | `listeners`: the JavaScript's desktop event subscriptions ([Leak counters](#leak-counters)). `E_TIMEOUT` when no JavaScript answers. |
| `memory` | | `footprintMB` (the process's physical footprint, as Activity Monitor's Memory column) and `residentMB`, from `task_info`. |
| `quit` | | `ok`, then the session ends and the app quits. |

Optional modules add commands with `SparkTestDriverRegisterCommand` (main thread; built-in
names, including the input commands, and duplicate names are refused), because the driver cannot link them itself. The motion
package registers its virtual clock, `setClock` and `advanceClock`
([motion.md](motion.md#virtual-clock-for-the-test-driver)), and its telemetry, `motionState`,
`waitForMotion` and `sampleMotion` ([motion.md](motion.md#motion-telemetry)). An app without
that module answers them with `E_UNKNOWN_COMMAND`. The system package registers `simulateSystemEvent`
([system.md](system.md#testing-system-events)). The window package registers `simulateDisplays`, the
display source of `@legendapp/spark/displays` and of window geometry ([displays.md](displays.md#simulated-displays)). The clipboard
package moves `@legendapp/spark/clipboard` onto a private pasteboard when the driver starts, and registers
`setTestClipboard` and `testClipboard` to write and read it as another app would ([clipboard.md](clipboard.md#testing)). The
drag-drop package registers `testDrag`, which runs a drag between Spark drag views in process as the window server
would, and drops promised files in a temporary folder as Finder would ([drag-drop.md](drag-drop.md#testing)). The permissions package
answers `@legendapp/spark/permissions` from simulated state in driver mode, never from TCC, and registers
`simulatePermission` and `testPermission` to set and read it ([permissions.md](permissions.md#testing)). The biometrics package answers `@legendapp/spark/biometrics` from simulated state in driver mode,
never showing a Touch ID prompt or touching a keychain, and registers `simulateBiometrics` and `testBiometrics`
([biometrics.md](biometrics.md#testing)). The sharing package
records what `@legendapp/spark/sharing` would share and index in driver mode, never showing a picker, writing the Spotlight index or
setting the Services provider, and registers `simulateSharing` and `testSharing` ([sharing.md](sharing.md#testing)); the links package
keeps default URL handlers in memory instead of LaunchServices ([links-and-documents.md](links-and-documents.md#default-url-handler)).
The global-shortcuts package
never registers a hotkey with the system in driver mode (registrations keep their conflict checks in the app) and
registers `simulateGlobalShortcut` (`key`, `modifiers` as NSEventModifierFlags bits), which delivers a registered
shortcut's press; it fails `E_NOT_FOUND` when nothing is registered for that key. With simulated displays
(`simulateDisplays`), window geometry in `@legendapp/spark/windows` (`getDisplays`, bounds, positions, centering)
uses them too, so windows can be placed on displays the Mac does not have; the windows are never on screen.

Modules also get four hooks (`SparkTestDriver.h`, main thread): `SparkTestDriverFindView`
finds a view by testID as `waitFor` does; `SparkTestDriverObserveStart` runs a block once the
driver starts, never outside driver mode (motion turns its telemetry on there);
`SparkTestDriverObserveInput` runs a block before
every input command and before `navigate` and `openFile` deliver (motion uses it to tell
motion caused by the last input from earlier motion); `SparkTestDriverWrapRender` wraps every
`capture` render (motion uses it to render running animations at their presented values).

Requests run as main run-loop blocks in the common modes, not on the main dispatch queue.
A nested run loop started from a main-queue block does not drain the main queue, so a
modal or tracking loop the app enters would otherwise block every later request; run-loop
blocks also run inside those loops.

"Settled" means no Fabric mount transaction for 100 ms. The host reports mounts through
`RCTSurfacePresenterObserver`. `main` is the window with identifier `spark.main`. `key`
fails with `E_NO_WINDOW` in driver mode, because an app that never activates has no key window.

## Input

`tap`, `hover`, `drag`, `scroll`, `gesture`, `pressKey` and `typeText`
(`packages/desktop-app/macos/SparkTestDriverInput.mm`) create NSEvents in the app and
dispatch them through its own event path. Nothing is posted to the system event stream:
the real pointer and keyboard are untouched, other apps never see the events, and no TCC
permission is involved. This is white-box input. The black-box backend
([#50](https://github.com/LegendApp/legend-spark/issues/50)) remains the check of real
user input.

A target is `testID` (the first visible view with that testID; `offset` `{x, y}` in
points from its top-left, else its center), or `point` `{x, y}` in `waitFor` frame
coordinates of `window` (`main` by default). Coordinates are points at any backing scale;
the driver converts them to window coordinates (y-up). As XCUITest and Playwright do, a
`testID` target is scrolled into view first (`scrollRectToVisible:`), and the click must
reach it: when the point hit-tests to a view outside the target, the command fails with
`E_NOT_HITTABLE`. An unknown testID is `E_NOT_FOUND`; a bad window is `E_NO_WINDOW`.

Key commands go to `window`, else to the window of the last pointer input (as a click
makes a window key), else to the main window.

A command replies when its events have been dispatched. When the app enters a nested run
loop while handling the last event (a modal session), the command replies then, and later
requests run inside that loop. When input opens a native menu, the driver closes it at
once and fails with `E_MENU`: a menu tracks the real pointer and keyboard on screen, so
menus need the black-box backend.

What AppKit does with in-process events, measured in `tests/test-driver.native.mm` (mode
`input`) and in scratch programs while building this, shapes the design:

| Observation | Consequence |
| --- | --- |
| `-[NSWindow sendEvent:]` drops mouse events for a window that is not on screen; it treats them as clicks that should activate the app first. | A pointer command orders its window in for its duration: alpha 0, `ignoresMouseEvents`, `orderBack:`, never key. |
| A window ordered in without a first responder gives keyboard focus to its `initialFirstResponder` or else its first key view, on every order-in. In a React Native window that is the first focusable Pressable (the Kitchen Sink's All screens row), which presses on Return and Space (#371). A shown app's window stays on screen and is first shown with its startup placeholder, so nothing takes focus that way. | After ordering a window in for a pointer command, the driver gives the first responder back to whatever had it (the window itself when nothing had focus). The view AppKit picked still gets `becomeFirstResponder` and then `resignFirstResponder`, so a React Native view sees `onFocus` and `onBlur`. |
| A window on screen that is not the key window ignores its default button's Return key equivalent, and so does a window that has been on screen once; one never shown does not. Other key equivalents (Escape, Command-key) are unaffected. | The driver performs `defaultButtonCell` on Return or Enter for the window it treats as key, after the window's own key equivalents. |
| A driven app never activates, so it has no key window, and `-[NSApplication sendEvent:]` gives key events only to local event monitors and menu key equivalents. Local monitors run in hash-table order, so the driver cannot place one after the app's. | Key events are routed as AppKit routes them to a key window: the window's key equivalents, the main menu's for Command and Control keys only (NSMenu ignores the Function flag, so the system's Globe-key items, Fn-D Start Dictation, Fn-E Emoji & Symbols and Fn-F Full Screen, would take plain typed letters), then `-[NSWindow sendEvent:]` (the first responder). Local event monitors (`NSEvent addLocalMonitorForEvents…`) do not see driver key events. |
| Every click into an inactive app is a first-mouse click: views that refuse `acceptsFirstMouse:` ignore it. AppKit controls accept it; React Native views refuse unless their `acceptsFirstMouse` prop is set. | For the duration of a press, the driver sets `acceptsFirstMouse` on the React Native views (`RCTUIView`) under the pointer, as in the key window of an active app, and restores it. |
| AppKit controls take keyboard focus and arrow keys only in the key window: a click does not make a slider or button the first responder, and `NSSlider` ignores arrow-key `keyDown`s even as first responder (its `moveRight:` works). | Arrow keys reach text and custom views. Stepping an AppKit control with the keyboard needs the black-box backend. |
| React Native matches a mouse-up or drag to its mouse-down by event number, which the window server shares across one press. | A press, its drags and its release share one event number. |
| Control tracking loops (`NSButton`, `NSSlider`, text selection) dequeue the rest of a gesture from the event queue. | A pointer command posts all of its events to the queue, then dispatches what no tracking loop took. |
| The event queue drops key event characters outside the Basic Multilingual Plane (emoji). | Key events are dispatched directly, not through the queue. |
| Mouse moves from the window server carry `deltaX`/`deltaY`; `+[NSEvent mouseEventWithType:…]` cannot set them, and NSEvent has no scroll wheel factory. | Moves and scroll wheel events are retyped copies of AppKit-made mouse events (`CGEventCreateCopy`, the public `CGEventField`s, `+[NSEvent eventWithCGEvent:]`). They are never posted. |
| Tracking areas get `mouseEntered:`/`mouseExited:` from the window server. | Pointer moves send entered and exited events for the tracking areas the driver's pointer enters and leaves. An `NSTrackingInVisibleRect` area covers its view's `visibleRect`, which since macOS 14 extends past the bounds of views that do not clip. |
| `NSScrollView` flings phased (trackpad gesture) scroll events delivered in a burst. | `scroll` sends one event without gesture or momentum phases; `precise` gives pixel deltas. |
| `+[NSEvent mouseEventWithType:…]` numbers every other-mouse event button 2. | Back and forward presses are copies with `kCGMouseEventButtonNumber` 3 and 4, located as gestures are (below; macOS 26 moves a copy's location) and checked: a press AppKit does not place at the target fails `tap` with `E_UNSUPPORTED`. |
| NSEvent has no factory for trackpad gestures. The window server sends them as gesture events (CGEvent type 29) whose HID type names the gesture, and `+[NSEvent eventWithCGEvent:]` makes the magnify, rotate, swipe, smart magnify or pressure NSEvent from it. The fields are private: HID type 110 (8 magnify, 5 rotate, 16 swipe, 22 smart magnify, 32 pressure), magnification 113, rotation 114, swipe direction 115 (IOHIDSwipeMask: up 1, down 2, left 4, right 8), phase 132 (1 began, 2 changed, 4 ended), stage 143, stage transition 147, pressure 148. | Gestures are retyped copies of a mouse move AppKit made at the point, with those fields, never posted. AppKit takes a gesture's `locationInWindow` from the event's window-local location (top-left origin), a private field that setting the global location clears, so the driver sets both from the mouse event (`CGEventSetLocation`, and the private `CGEventSetWindowLocation`). It then checks every event AppKit makes (type, window, location, phase and values); on a mismatch, or without those functions, `gesture` fails with `E_UNSUPPORTED` naming the macOS version, and nothing is delivered. Measured on macOS 27; CI runs `tests/test-driver.native.mm` (mode `pointer`) on its macOS. |
| `-[NSApplication sendEvent:]` drops magnify, rotate, swipe and smart magnify events in an app without a key window; `-[NSWindow sendEvent:]` gives them to the view under the pointer. NSWindow drops a magnify or rotate change that no began event started. | The driver sends those gestures to the window, as it does keys, and starts every magnify and rotate with a began event. Pressure events go through the queue with their click and reach the view only with a gesture phase. |

## Private event functions

Gestures (`gesture`) and the back and forward buttons (`tap` with `button: back` or `forward`) need
the private CoreGraphics functions `CGEventGetWindowLocation` and `CGEventSetWindowLocation` (see
the table above). Mac App Store review flags private API names found in a binary, even when they are
never called. So these functions compile only with the preprocessor flag
`SPARK_TEST_DRIVER_PRIVATE_EVENTS=1`, in builds that have the driver ([Builds](#builds)):

- **Off (the default)**: the code and the functions' names are absent from the binary.
  `gesture`, and `tap` with `back` or `forward`, fail with `E_UNSUPPORTED`: "The app was built
  without SPARK_TEST_DRIVER_PRIVATE_EVENTS …". Every other command works.
- **On**: an app sets `"macos": { "testDriverPrivateEvents": true }` in `desktop.config.json`.
  The config plugin then exports `SPARK_TEST_DRIVER_PRIVATE_EVENTS=1` in the generated Podfile,
  and the `RNDesktopApp` podspec adds the flag to its `GCC_PREPROCESSOR_DEFINITIONS`, in debug
  and release builds. The Kitchen Sink, which the gate drives, opts in. Never turn it on for an
  app you distribute.
- The names are not hidden or built at run time; that would evade review.

`tests/test-driver-native.test.ts` builds the driver both ways. It checks that the build without
the flag does not contain the names and fails these commands typed, and that the opted-in build
contains them. `tests/test-driver-builds.test.ts` checks the configuration, the Podfile
line and the podspec's build settings.

## Cursor

A driven app must never change the cursor of the person using the Mac. In driver mode
(`SparkTestDriverCursor.mm`) nothing the app does reaches the real cursor: `-[NSCursor set]`
and `-push` are recorded, `-pop`, `+pop`, `+hide` and `+unhide` do nothing, and
`+[NSCursor setHiddenUntilMouseMoves:]` is recorded instead of applied. AppKit text views call it on every typed key, and so does Spark's
`hideCursorUntilMoved` ([pointer.md](pointer.md)). The next pointer move of the driver ends it, as a
real move would. The real cursor is never hidden, moved or set by the driver.

`cursor` reports the cursor AppKit would show at a point, without applying it. The driver
asks each view under the point, innermost first, for its cursor rects
(`-resetCursorRects`, which React Native's `cursor` style and Spark's `PointerView` custom
cursor use) and records them instead of installing them. Then it rebuilds the views'
real cursor rects. If no rect covers the point, it sends the views' cursor-update tracking
areas a `cursorUpdate:` and takes the cursor it sets. Otherwise it reports the
arrow. AppKit's shared cursors are reported by name (`arrow`, `IBeam`, `IBeamVertical`,
`pointingHand`, `crosshair`, `openHand`, `closedHand`, `operationNotAllowed`, `dragLink`,
`dragCopy`, `contextualMenu`, `disappearingItem`, `resizeLeftRight`, `resizeUpDown`,
`resizeLeft`, `resizeRight`, `resizeUp`, `resizeDown`, and on macOS 15 and later
`columnResize`, `rowResize`, `zoomIn` and `zoomOut`), including AppKit's copies of them. Some
are one object under two names (macOS 15's `columnResize` is `resizeLeftRight`), and the
first name wins. Any other cursor is `custom(<image accessibility description>)`, or
`custom` without a description; Spark names its custom cursors after the SF Symbol or file.

A driven window is never key. While a text field is edited outside the key window, AppKit
gives its field editor a copy of the arrow, so `cursor` reports `arrow` over a focused
single-line field. A field that is not being edited reports `IBeam`.

## Frame timing

`startFrames` adds a `CADisplayLink` for the main screen (a driven app's windows are never on
screen, so the link belongs to the screen) to the main run loop in the common modes, at the
display's maximum rate. Every callback is a frame the main thread was free to produce. A gap
between two callbacks of more than one refresh interval (`targetTimestamp − timestamp`) counts
the missed intervals in `droppedFrames`; `fps` is frames per second between the first and last
callback. This measures the app's main-thread cadence against the display's refresh, the
budget every UI update and gesture has. It is not a measurement of what the window server
composited, which needs out-of-process instrumentation (#50). `tests/test-driver.native.mm`
(mode `hooks`) checks that an idle main thread keeps the display's cadence and that blocking
it for 250 ms drops frames and shows a gap of at least 240 ms.

The counter is the frame timeline that the development profiler records too (`SparkFrameTimeline.mm`,
[devtools.md](devtools.md#frame-timeline)): each callback's timestamp and the MotionViews animating in it, which
`stopFrames` returns when `startFrames` asked for it (`timeline: true`). Without it the counter polls no motion, so a
frame budget measures nothing else.

## Startup phases

The driver records when a driven launch reaches each phase, on one clock (`CACurrentMediaTime`), and `startup`
reports them in milliseconds from the moment the kernel started the process (`p_starttime` from `sysctl`, the
runner's spawn):

| Phase | When |
| --- | --- |
| `willFinishLaunching` | The driver starts, first thing in the host's `applicationWillFinishLaunching:` |
| `didFinishLaunching` | `NSApplicationDidFinishLaunchingNotification` |
| `bundleLoaded` | React Native has run the JavaScript bundle (`RCTInstanceDidLoadBundle`, posted on the JavaScript thread) |
| `firstMount` | The first mounted UI transaction |
| `settled` | The first quiet point that shows an element: the last mount before 100 ms without one, when a window showed a visible view with a testID |
| `ready` | With `testID`: the first quiet point at which that element showed. An app that first shows a placeholder (the Kitchen Sink's "Starting…"), then its content once asynchronous setup finishes, settles with the placeholder and is ready with the content. |

The driver records quiet points during the first 60 s after the first mount (at most 50), when a wait for settling or
the check each mount schedules 100 ms later sees the UI quiet; a quiet point those checks miss before the next mount is
not recorded. A phase the app never reached is absent. Later mounts (navigation, input) never change them. The driven window is
never on screen, so `firstMount` is the first UI committed, not composited. Every driver launch is a new process, but
the file cache may hold the app from an earlier launch, so `settled` is a fresh-process launch, not a cold boot.
`assertStartup` records `settled` (with `id`, `ready`) as `startup.coldMs` and `firstMount` as `startup.firstPaintMs`
([docs/e2e-flows.md](e2e-flows.md#app-inspection)). `tests/test-driver.native.mm` (mode `startup`) checks the order
of the phases, that a quiet UI without elements has not settled, that `settled` is a mount of the first UI with one,
and `ready` for an element that shows later and one that never does.

## Exposed state

`assertState` checks app state that is not on screen. The app exposes it by name from `@legendapp/spark/app`:

```ts
import { exposeTestState } from "@legendapp/spark/app";

const registration = exposeTestState("documents", () => documentStore.get()); // { remove() }
```

`state` with `path: "documents.open.length"` posts a `driverState` desktop event; `exposeTestState` answers through
the `NativeDesktopApp` module (`replyDriverState`) with the value of `read()` at the path: the name, then own
properties or array indices separated by dots. `read` runs only when a driver session asks, so it costs nothing
outside driver mode. The value must be JSON data; `undefined`, functions and symbols fail `E_INVALID_DATA`, and
`read` throwing fails `E_STATE`. A name nobody exposed, or a key the value does not have, fails `E_NOT_FOUND`. Names
are JavaScript identifiers, exposed once at a time (`E_ALREADY_EXISTS`). The Kitchen Sink exposes `navigation` (its
current route) and `app` (its app-wide state: locale, errors, the document) in `shell/app-controller.ts`.
`tests/test-driver.native.mm` (mode `state`) checks the native relay and `tests/test-state.test.ts` the JavaScript.

## Layout thrash and flicker

Between `startCommits` and `stopCommits` (`packages/desktop-app/macos/SparkTestDriverCommits.mm`) the driver walks
every window's views each time the main run loop commits its Core Animation transaction: a run-loop observer in the
common modes, ordered right after Core Animation's commit, before the run loop waits. That is the model the next frame
shows; a driven window is never on screen, so nothing is composited. A commit that changed no view frame and no
visible element is not counted. Elements are views with a testID; a view is visible when neither it nor an ancestor is
hidden or has alpha 0, and it has an area.

- `relayouts`: views whose frame (in their superview) changed in more than one commit, with their frames in order (at
  most 8). The frame a view has when it is mounted, or when watching starts, is not a change. A view without a testID
  is named by its class and the nearest enclosing testID.
- `gaps`: elements that were visible, then not visible for one or more commits, then visible again: a partial frame.
  An element that leaves for good, or appears, is not a gap.
- `blanks`: commits in which a window that showed elements showed none.

What it cannot see: changes within one commit (a frame set twice before the commit is one change), pixels (a view
that draws nothing is still visible), and the window server's compositing (#50). Virtualized lists remove rows that
scroll out and add them back, which is a gap. `tests/test-driver.native.mm` (mode `commits`) checks each report on
AppKit views changed in separate run-loop turns.

## Leak counters

`counters` waits for mounted UI updates to settle, then counts:

| Counter | What |
| --- | --- |
| `windows` | `NSApp.windows`: every window AppKit holds, shown or not |
| `views` | Views in those windows' trees (frame view included). Views React Native keeps for reuse outside the tree are not counted. |
| `fileDescriptors` | The process's open file descriptors (`proc_pidinfo`), files and sockets included |

`listeners` asks the app's JavaScript, like `state`, for the subscriptions of Spark's desktop event hub
(`onDesktopEvent` in `@legendapp/spark-desktop-app`), which app, window, link, system, notification, tray, update,
process and global-shortcut listeners use. Packages with their own event emitters (menus, shortcuts, audio, file
system) are not counted. Only the main JavaScript runtime answers; with no JavaScript observing desktop events it is
0. `tests/test-driver.native.mm` (modes `commits` and `state`) and `tests/test-state.test.ts` check them.

## Accessibility audit

`accessibilityAudit` (`packages/desktop-app/macos/SparkTestDriverAudit.mm`) collects what the audit rules need from
inside the process; the runner judges it (`auditAccessibility`, [docs/e2e-flows.md](e2e-flows.md#accessibility-audit)).
Without TCC there is no AX client, so these are the views' own NSAccessibility answers, not what VoiceOver reads
through the accessibility API.

- `elements`: in each window's content view (the title bar and its buttons are AppKit's), every view that is an
  accessibility element, every control (through its cell), and every view that draws non-blank text (React Native
  `Text`, non-editable text fields): `key`, `parent`, `window`, `id` (testID), `within` (the nearest testID of it or
  an ancestor), `frame` (as `waitFor`), `element` (AppKit exposes it), `role` (as `elements`), `label`, `title`,
  `placeholder`, `value`, `help`, `editable` (for views that can be), `focusable` (an AppKit control that does not
  refuse first responder, another view that accepts it, or anything inside a table, outline or collection view), `enabled` (false inside a disabled AppKit
  control or a React Native view whose `isAccessibilityEnabled` is NO, which [the accessibility state
  patch](expo-desktop-integration.md#rn-macos-accessibility-state-patch) answers from `accessibilityState.disabled`;
  other views, such as text views, report NO whether or not they are enabled, so it is not read from them), and `opacity` (the product of its and
  its ancestors' layer opacity). A text also has `text` and `textStyle`: its distinct
  foreground colours resolved to sRGB in the view's effective appearance (`r`, `g`, `b` 0-255, `a` 0-1; `unresolved`
  when one is not an sRGB colour), its smallest font size in points, and whether every run is bold. Colours of a
  vibrant appearance (a sidebar's) are resolved in the matching non-vibrant one: they are translucent greys the
  window server blends with what is behind them, which an in-process render skips. While its window is not key (a
  driven window never is), AppKit draws a source list's text fields at half opacity through their layer; their
  `opacity` is their `alphaValue`, as a user sees them in the active window.
- `captures`: sRGB renders of the window, `<name>-<n>.png` in the run directory, as `capture` renders it. Each visible
  text has `capture` (an index) and `sample` (the pixels of that render that show it). A text the window does not
  show is scrolled into view (`scrollRectToVisible:`, as pointer input does) and the window is rendered again, until
  every text was rendered whole, or as much of it as scrolling can show (`clipped`). A text nothing can show has no
  `sample`. Every scroll position is restored before the reply.

`tests/test-driver.native.mm` (mode `audit`) checks an undescribed image button, a button-role view that cannot take focus, a disabled React Native view and its text, a text's declared colour and sample,
and a text below the fold of a scroll view that the audit scrolls to, renders and scrolls back.

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
| Selected source-list rows (the unemphasized selection material; driver windows are never key) | Substituted: the selection is a black layer the window server tints with a vibrant compositing filter (a sublayer of an `NSVisualEffectView` on macOS 27, the selection view's own layer on macOS 26), so `capture` hides it under `unemphasizedSelectedContentBackgroundColor` for the row's appearance and restores it afterwards |
| Window shadow and rounded corners | No: outside the frame view |

`cacheDisplayInRect:` renders a layer's model `transform` and `opacity`, but not Core
Animation animations (measured while building #52: a layer translated by its model transform
rendered moved; the same translation as a running `CABasicAnimation` did not). Running motion
would render at its final values, so the motion module wraps every capture render
(`SparkTestDriverWrapRender`) and gives each `MotionView` its presented values, the engine's
state at the current time, for the duration of the render, then restores the model.

`-[CALayer renderInContext:]` on the frame view's or content view's layer was also tried.
For a window that was never shown, it produced an empty, transparent image even after
`[CATransaction flush]`, with no layer colors, drawn content or images. The driver does
not offer it. Content the window server composites, such as behind-window vibrancy,
needs an out-of-process capture, which requires the TCC grant tracked in #50.
