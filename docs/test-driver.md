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
bun run ks:capture <area>/<screen> [--appearance light|dark] [--locale ar] [--out e2e/verification/<N>/] [--dev-bundle]
bun run ks:capture --wait-for infra-shell-root --name catalog-dark --appearance dark   # the launch screen
```

`ks:capture` bundles the current JavaScript (no Metro), launches the app in driver mode,
navigates to `spark-ks://<area>/<screen>`, waits for `<area>-<screen>-root` (or
`--wait-for <testID>`), applies the app appearance (light by default), renders the main
window to `<out>/<name>.png` and quits. The default name is
`<area>-<screen>-<appearance>[-<locale>]` and the default output directory is
`examples/kitchen-sink/.spark/captures`. `--locale` launches with `-AppleLanguages`. The JavaScript is built without `__DEV__`, like a release
bundle; `--dev-bundle` serves a development bundle instead, to capture development-only UI.

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

`tests/window.native.mm` checks that windows opened, shown, hidden and made modal in driver
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
| `elements` | | `windows` (`id`, `title`, `key`, `main`, `frame`), front to back, and `elements`: the in-process accessibility view of every window with an identifier. An element is a visible view with a testID, or an accessibility element (controls through their cells) with a role, label or text: `key`, `parent` (the key of the nearest enclosing element), `window`, `id`, `role` (the NSAccessibility role without `AX`: `button`, `staticText`, `radioButton`), `label`, `text` (the string value, else the title, else the displayed text of a view with attributed text, such as React Native `Text`), `value` (the accessibility value as a string, numbers included) and `frame` (as `waitFor`). A view inside an element with the same testID (the native control a React Native view hosts) refines that element. The components of an `NSPathControl` (accessibility elements that are not views) are elements too. A window's `frame` is its frame view, at 0,0. |
| `setAppAppearance` | `appearance` (`light`/`dark`), `timeoutMs` (10000) | Waits for the first rendered UI to settle (an override set while the app is still launching did not last), then sets `NSApp.appearance` (an app override; the OS setting is untouched; per-window appearances still win). If the effective appearance changed, replies `changed: true` once a UI update has mounted and settled, else `E_TIMEOUT`. `timeoutMs` bounds each wait. |
| `capture` | `window` (`main`, `key`, `id:<identifier>`, `title:<title>`), `name`, `timeoutMs` (5000) | `file`, `width`, `height` (pixels), `scale`, once mounted UI updates have settled. `E_NOT_SETTLED` if they never do. |
| `tap` | target, `button` (`left`/`right`), `clickCount` (1-3), `modifiers` | Moves the driver's pointer to the target, then presses and releases `clickCount` times. |
| `hover` | target | Moves the driver's pointer to the target. |
| `drag` | `from`, `to` (targets in one window), `window`, `steps` (10, 1-500), `modifiers` | Presses at `from`, moves to `to` in `steps` dragged events, releases. |
| `scroll` | target, `deltaX`, `deltaY`, `precise` (false), `modifiers` | One scroll wheel event over the target. Deltas are positive toward the end of the content (down, right): points when `precise`, else lines. |
| `pressKey` | `key`, `modifiers`, `window` | One key press. `key` is one character: a character key, or AppKit's character for a function key (`"\r"` Return, `"\u001b"` Escape, `"\u007f"` Delete, `"\uf700"` Up arrow, `"\uf704"` F1). |
| `typeText` | `text`, `window` | One key press per user-perceived character, any Unicode (no input method). A newline presses Return. |
| `menus` | | `menus`: the application menu bar (`NSApp.mainMenu`) as a tree, after `-[NSMenu update]` validates it, so `enabled` and `state` are what a user opening the menu sees. Items have `title`, `id`, `enabled`, `hidden`, `state` (`on`/`off`/`mixed`), optional `shortcut` (`key`, `modifiers` as NSEventModifierFlags bits), `toolTip`, `alternate` and `items`; separators are `{ "separator": true }`. The system Services menu is not expanded. A driven app shows no menu bar, but it has one. |
| `quit` | | `ok`, then the session ends and the app quits. |

Optional modules add commands with `SparkTestDriverRegisterCommand` (main thread; built-in
names, including the input commands, and duplicate names are refused), because the driver cannot link them itself. The motion
package registers `setClock` and `advanceClock`, its virtual clock
([motion.md](motion.md#virtual-clock-for-the-test-driver)). An app without that module
answers them with `E_UNKNOWN_COMMAND`.

Requests run as main run-loop blocks in the common modes, not on the main dispatch queue.
A nested run loop started from a main-queue block does not drain the main queue, so a
modal or tracking loop the app enters would otherwise block every later request; run-loop
blocks also run inside those loops.

"Settled" means no Fabric mount transaction for 100 ms. The host reports mounts through
`RCTSurfacePresenterObserver`. `main` is the window with identifier `spark.main`. `key`
fails with `E_NO_WINDOW` in driver mode, because an app that never activates has no key window.

## Input

`tap`, `hover`, `drag`, `scroll`, `pressKey` and `typeText`
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
