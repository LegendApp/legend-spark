import {
  accelerator, anyKey, anyStr, anyValue, bool, bound, command, commands, condition, dict, duration, fraction, int, list, menuPath, modifier,
  num, obj, oneKey, oneOf, percent, pixels, point, scope, selector, SELECTOR_PROPS, size, str, TARGET_KEYS, text, windowSelector, WINDOW_PROPS,
  type Schema,
} from "./primitives.ts";

export const GROUPS = {
  lifecycle: "Lifecycle", windows: "Windows / multiwindow", menus: "Menus", keyboard: "Keyboard & text", pointer: "Pointer / trackpad",
  drag: "Drag & drop", files: "Clipboard / files / dialogs", environment: "Environment / OS state", shell: "Notifications / Dock / taskbar / tray",
  motion: "Motion", visual: "Visual", a11y: "Accessibility", i18n: "i18n", performance: "Performance", network: "Network / processes / updates",
  state: "State introspection", control: "Control flow", manual: "Manual steps",
} as const;

export type CommandSpec = {
  group: keyof typeof GROUPS;
  summary: string;
  /** Keys of the mapping form. Every command also accepts `when` and `timeout` unless it defines them itself. */
  props: Record<string, Schema>;
  required?: string[];
  /** The key a non-mapping value stands for: `pressKey: Escape` is `pressKey: { key: Escape }`. */
  shorthand?: string;
  /** Extra JSON Schema keywords for the mapping form, used for key alternatives. */
  rule?: Schema;
  /** Needs the Spark in-app driver (white-box) rather than OS input and the accessibility tree. */
  driver?: true;
  /** Maestro core vocabulary with Maestro semantics. */
  maestro?: true;
};

type Options = Omit<CommandSpec, "group" | "summary" | "props">;
const spec = (group: CommandSpec["group"], summary: string, props: Record<string, Schema> = {}, options: Options = {}): CommandSpec => ({ group, summary, props, ...options });
/** A command whose mapping form is a selector; a bare string is visible text. */
const onTarget = (group: CommandSpec["group"], summary: string, extra: Record<string, Schema> = {}, options: Options = {}) =>
  spec(group, summary, { ...SELECTOR_PROPS, ...extra }, { shorthand: "text", rule: anyKey(...TARGET_KEYS), ...options });
/** A command with one required key that may be written directly as the value. */
const single = (group: CommandSpec["group"], summary: string, key: string, value: Schema, extra: Record<string, Schema> = {}, options: Options = {}) =>
  spec(group, summary, { [key]: value, ...extra }, { required: [key], shorthand: key, ...options });

const clicks = { modifiers: list(modifier) };
const via = (...values: string[]) => oneOf(...values);
const launch = { arguments: list(str, 0), env: dict(anyStr), openFile: str, openUrl: str };
const appearance = oneOf("light", "dark", "system");

export const COMMANDS: Readonly<Record<string, CommandSpec>> = {
  // Lifecycle
  launchApp: spec("lifecycle", "Launch the app. Restarts it first when running unless stopApp is false.", { appId: str, clearState: bool, stopApp: bool, ...launch, from: via("finder", "dock", "cli") }, { maestro: true }),
  launchSecondInstance: spec("lifecycle", "Launch a second instance; pair with assertSingleInstance.", launch),
  assertSingleInstance: spec("lifecycle", "Assert exactly one app process is running."),
  stopApp: spec("lifecycle", "Stop the app.", {}, { maestro: true }),
  killApp: spec("lifecycle", "Kill the app process.", {}, { maestro: true }),
  quitApp: spec("lifecycle", "Quit the app the way a user would.", { via: via("menu", "shortcut", "dock", "sigterm", "logout", "shutdown") }),
  crashApp: single("lifecycle", "Crash the app.", "kind", oneOf("native", "js")),
  assertCrashRecovery: spec("lifecycle", "Assert the app recovers after crashApp."),
  relaunchApp: spec("lifecycle", "Quit and relaunch the app.", { preserveState: bool }),
  assertAppState: spec("lifecycle", "Assert process and activation state.", { running: bool, active: bool, hidden: bool, dockIconVisible: bool }, { rule: anyKey("running", "active", "hidden", "dockIconVisible") }),
  assertStartup: spec("lifecycle", "Assert startup phase timings in milliseconds.", { coldMs: bound(num), firstPaintMs: bound(num) }, { rule: anyKey("coldMs", "firstPaintMs"), driver: true }),

  // Windows / multiwindow
  assertWindow: spec("windows", "Assert window count and state; frame/fullscreen/level/edited/onDisplay apply to `window` (default key).", {
    window: windowSelector, count: int(), key: windowSelector, frame: obj({ x: num, y: num, w: num, h: num }, [], { minProperties: 1 }),
    fullscreen: bool, level: oneOf("normal", "floating", "modalPanel", "popUpMenu", "statusBar", "screenSaver"), edited: bool, onDisplay: int(1),
  }, { rule: anyKey("count", "key", "frame", "fullscreen", "level", "edited", "onDisplay") }),
  openWindow: spec("windows", "Open a new window.", { via: via("shortcut", "menu", "dock") }),
  closeWindow: spec("windows", "Close a window (default key).", { window: windowSelector, via: via("button", "shortcut", "menu") }),
  focusWindow: spec("windows", "Bring a window to front and make it key.", WINDOW_PROPS, { rule: anyKey(...Object.keys(WINDOW_PROPS)) }),
  resizeWindow: spec("windows", "Resize a window by dragging an edge.", { window: windowSelector, to: size, edge: oneOf("top", "bottom", "left", "right", "topLeft", "topRight", "bottomLeft", "bottomRight"), live: bool }, { required: ["to"] }),
  moveWindow: spec("windows", "Move a window by its title bar.", { window: windowSelector, to: obj({ x: num, y: num }, ["x", "y"]), live: bool }, { required: ["to"] }),
  minimizeWindow: spec("windows", "Minimize a window.", { window: windowSelector }),
  zoomWindow: spec("windows", "Zoom (maximize) a window.", { window: windowSelector }),
  toggleFullscreen: spec("windows", "Toggle fullscreen.", { window: windowSelector }),
  moveToDisplay: single("windows", "Move a window to another display.", "display", int(1), { window: windowSelector }),
  assertScale: single("windows", "Assert the backing scale factor of a window.", "scale", num, { window: windowSelector }),
  snapWindow: single("windows", "Snap a window to a screen layout.", "layout", oneOf("leftHalf", "rightHalf", "topHalf", "bottomHalf", "topLeft", "topRight", "bottomLeft", "bottomRight", "maximize", "center"), { window: windowSelector }),
  tearOff: spec("windows", "Drag a tab out into a new window.", { tab: str, from: windowSelector, to: point }, { required: ["tab", "to"] }),
  mergeInto: spec("windows", "Drag a tab into another window's tab bar.", { tab: str, from: windowSelector, to: windowSelector }, { required: ["tab", "to"] }),
  saveWorkspace: single("windows", "Save the window workspace.", "name", str),
  restoreWorkspace: single("windows", "Restore a saved window workspace.", "name", str),
  assertWindowsRestored: spec("windows", "Assert frame, route, scroll and selection per window were restored.", { matchGolden: bool }),
  assertGroupMoves: spec("windows", "Assert child windows move with their parent.", { parent: windowSelector, children: list(windowSelector) }, { required: ["parent", "children"] }),

  // Menus
  selectMenu: single("menus", "Choose an app menu item.", "path", menuPath),
  assertMenuItem: spec("menus", "Assert menu item state.", { path: menuPath, enabled: bool, checked: bool, shortcut: accelerator }, { required: ["path"] }),
  assertMenuAlternate: spec("menus", "Assert the alternate item shown while a modifier is held.", { path: menuPath, modifier, becomes: str }, { required: ["path", "modifier", "becomes"] }),
  openContextMenu: spec("menus", "Open a context menu on a target.", { on: selector, via: via("rightClick", "ctrlClick", "menuKey", "shiftF10") }, { required: ["on"] }),
  selectContextMenu: single("menus", "Choose an item in the open context menu.", "path", str),
  openDockMenu: spec("menus", "Open the Dock menu, optionally choosing an item.", { select: str }),
  openTrayMenu: spec("menus", "Open the tray menu, optionally choosing an item.", { select: str }),
  searchHelpMenu: spec("menus", "Search the Help menu.", { query: str, expectItem: menuPath }, { required: ["query"] }),

  // Keyboard & text
  pressKey: single("keyboard", "Press a key, such as Escape, Enter or F5.", "key", accelerator, {}, { maestro: true }),
  shortcut: single("keyboard", "Press a keyboard shortcut, such as cmd+shift+s.", "keys", accelerator),
  inputText: single("keyboard", "Insert text in one step (Maestro inputText).", "text", str, { into: selector }, { maestro: true }),
  typeText: single("keyboard", "Type text as per-key events.", "text", str, { into: selector }),
  imeCompose: spec("keyboard", "Compose text through an input method and commit a candidate.", { layout: str, keys: str, commit: str }, { required: ["layout", "keys"] }),
  setKeyboardLayout: single("keyboard", "Switch the keyboard layout; later shortcuts resolve by character.", "layout", str),
  holdKey: single("keyboard", "Hold a key or modifier down.", "key", str),
  releaseKey: single("keyboard", "Release a held key.", "key", str),
  assertFocused: onTarget("keyboard", "Assert the focused element."),
  assertFocusOrder: single("keyboard", "Tab through and assert focus order.", "targets", list(selector, 2)),
  selectText: spec("keyboard", "Select a text range.", { in: selector, range: { type: "array", items: int(), minItems: 2, maxItems: 2 } }, { required: ["in", "range"] }),
  assertSelection: spec("keyboard", "Assert the selected text range.", { in: selector, range: { type: "array", items: int(), minItems: 2, maxItems: 2 } }, { required: ["in", "range"] }),
  assertText: spec("keyboard", "Assert the full text of an element.", { id: str, equals: anyStr, lineEndings: oneOf("lf", "crlf", "cr") }, { required: ["id", "equals"] }),
  assertUndo: spec("keyboard", "Undo a number of steps, then assert the text.", { steps: int(1), then: obj({ equals: anyStr }, ["equals"]) }, { required: ["steps", "then"] }),

  // Pointer / trackpad
  tapOn: onTarget("pointer", "Click a target.", clicks, { maestro: true }),
  doubleClickOn: onTarget("pointer", "Double-click a target.", clicks),
  tripleClickOn: onTarget("pointer", "Triple-click a target.", clicks),
  rightClickOn: onTarget("pointer", "Right-click a target.", clicks),
  middleClickOn: onTarget("pointer", "Middle-click a target.", clicks),
  forceClickOn: onTarget("pointer", "Force-click a target.", clicks),
  hoverOn: onTarget("pointer", "Hover over a target.", { duration }),
  mouseButton: single("pointer", "Press an extra mouse button.", "button", oneOf("back", "forward")),
  assertVisible: onTarget("pointer", "Assert a target is visible.", {}, { maestro: true }),
  assertNotVisible: onTarget("pointer", "Assert a target is not visible.", {}, { maestro: true }),
  scroll: spec("pointer", "Scroll (Maestro: bare scroll scrolls down).", { on: selector, direction: oneOf("up", "down", "left", "right"), amount: num, precise: bool, momentum: bool }, { maestro: true }),
  swipe: spec("pointer", "Swipe by direction, or from start to end.", { from: selector, direction: oneOf("up", "down", "left", "right"), start: point, end: point, fingers: int(1), duration }, { rule: anyKey("direction", "start"), maestro: true }),
  pinch: spec("pointer", "Pinch to zoom.", { on: selector, scale: num }, { required: ["scale"] }),
  rotate: spec("pointer", "Rotate with two fingers.", { on: selector, degrees: num }, { required: ["degrees"] }),
  assertCursor: single("pointer", "Assert the pointer cursor shape.", "cursor", str, { on: selector }),
  assertTooltip: spec("pointer", "Hover a target and assert its tooltip.", { on: selector, text, within: duration }, { required: ["on", "text"] }),

  // Drag & drop
  dragAndDrop: spec("drag", "Drag from one target to another.", { from: selector, to: selector, modifiers: list(modifier), holdAt: duration, steps: int(1) }, { required: ["from", "to"] }),
  dragFromFinder: spec("drag", "Drag files from the file manager onto a target.", { files: list(str), to: selector }, { required: ["files", "to"] }),
  dragToFinder: spec("drag", "Drag a target to the file manager and expect a file.", { from: selector, expectFile: str }, { required: ["from", "expectFile"] }),
  dragToDock: spec("drag", "Drag files onto the Dock icon.", { files: list(str) }, { required: ["files"] }),
  cancelDrag: spec("drag", "Start a drag, cancel it, and assert the fly-back.", { from: selector, via: via("escape", "dropOutside") }, { required: ["from"] }),

  // Clipboard / files / dialogs
  setClipboard: spec("files", "Set the clipboard.", { html: str, text: anyStr, concealed: bool }, { rule: anyKey("html", "text") }),
  assertClipboard: spec("files", "Assert clipboard types and text.", { types: list(str), text: anyStr }, { rule: anyKey("types", "text") }),
  createFixture: spec("files", "Create a file for the flow.", { path: str, contents: anyStr, encoding: oneOf("utf-8", "utf-16le", "utf-16be", "latin1") }, { required: ["path"] }),
  modifyFileExternally: spec("files", "Change a file behind the app's back.", { path: str, append: anyStr, contents: anyStr, atomicSwap: bool }, { required: ["path"], rule: anyKey("append", "contents") }),
  assertFile: spec("files", "Assert file state.", { path: str, exists: bool, contains: anyStr, encoding: oneOf("utf-8", "utf-16le", "utf-16be", "latin1"), unchanged: bool }, { required: ["path"] }),
  mountFixtureVolume: spec("files", "Mount a disk image as a volume.", { image: str, as: str }, { required: ["image", "as"] }),
  ejectVolume: single("files", "Eject a mounted volume.", "volume", str),
  handleDialog: spec("files", "Complete an open or save panel.", { kind: oneOf("save", "open"), name: str, path: str, files: list(str), confirmOverwrite: bool, cancel: bool }, { required: ["kind"] }),
  assertDialog: spec("files", "Assert an alert, sheet or panel.", { kind: oneOf("alert", "sheet", "save", "open"), text, buttons: list(str), default: str, attachedTo: windowSelector }),

  // Environment / OS state (the runner restores everything after the flow)
  setAppearance: single("environment", "Set the OS appearance.", "appearance", oneOf("light", "dark", "auto")),
  setAppAppearance: single("environment", "Override the app's own appearance in-process; the OS setting is untouched (setAppearance changes the OS).", "appearance", appearance, {}, { driver: true }),
  setAccentColor: single("environment", "Set the OS accent color.", "color", oneOf("multicolor", "blue", "purple", "pink", "red", "orange", "yellow", "green", "graphite")),
  setAccessibility: spec("environment", "Set OS accessibility preferences.", { reduceMotion: bool, increaseContrast: bool, reduceTransparency: bool, textScale: num }, { rule: anyKey("reduceMotion", "increaseContrast", "reduceTransparency", "textScale") }),
  setLocale: spec("environment", "Set the OS language and region formats.", { language: str, region: str, calendar: str, clock: oneOf("12h", "24h") }, { required: ["language"] }),
  setTimeZone: single("environment", "Set the OS time zone.", "timeZone", str),
  setSystemClock: single("environment", "Shift or set the OS clock.", "offset", { type: "string", pattern: "^([+-]\\d+(ms|s|m|h|d)|\\d{4}-\\d{2}-\\d{2}(T[0-9:.]+Z?)?)$", description: "an offset such as \"+3d\" or an ISO date" }),
  setDisplays: single("environment", "Configure virtual displays.", "displays", list(obj({ id: int(1), scale: num, refresh: num, arrangement: oneOf("leftOf", "rightOf", "above", "below") }, ["id"]))),
  unplugDisplay: single("environment", "Disconnect a display.", "display", int(1)),
  sleepSystem: spec("environment", "Put the OS to sleep and wake it.", { for: duration }, { required: ["for"] }),
  simulatePower: spec("environment", "Simulate power source and thermal state.", { source: oneOf("battery", "ac"), lowPower: bool, thermal: oneOf("nominal", "fair", "serious", "critical") }, { rule: anyKey("source", "lowPower", "thermal") }),
  setNetwork: spec("environment", "Shape the network.", { offline: bool, latency: duration, bandwidth: { type: "string", pattern: "^\\d+(\\.\\d+)?(kbps|mbps|gbps)$", description: "a bandwidth such as 1.5mbps" }, proxy: str }, { rule: anyKey("offline", "latency", "bandwidth", "proxy") }),
  lockScreen: spec("environment", "Lock the screen for a while.", { for: duration }, { required: ["for"] }),
  permission: spec("environment", "Grant, revoke or reset a privacy permission.", Object.fromEntries(["grant", "revoke", "reset"].map(key => [key, oneOf("camera", "microphone", "notifications", "location", "contacts", "calendars", "reminders", "photos", "accessibility", "screenRecording", "inputMonitoring", "fullDiskAccess", "automation")])), { rule: oneKey("grant", "revoke", "reset") }),
  setFocusMode: single("environment", "Set the OS Focus mode.", "mode", oneOf("off", "doNotDisturb", "sleep", "work", "personal")),

  // Notifications / Dock / taskbar / tray
  assertNotification: spec("shell", "Assert a delivered notification.", { title: text, body: text, actions: list(str) }, { rule: anyKey("title", "body") }),
  clickNotification: spec("shell", "Click a notification.", { title: text, body: text }),
  notificationAction: single("shell", "Choose a notification action.", "action", str),
  replyToNotification: single("shell", "Reply to a notification.", "text", str),
  assertDockBadge: single("shell", "Assert the Dock badge (empty string = no badge).", "value", { type: ["string", "integer"] }),
  assertDockProgress: single("shell", "Assert Dock progress.", "value", fraction),
  assertBounce: single("shell", "Assert the Dock icon bounces.", "kind", oneOf("informational", "critical", "none")),
  clickDockIcon: spec("shell", "Click the Dock icon."),
  clickTray: spec("shell", "Click the tray icon.", { button: oneOf("left", "right", "middle") }),
  assertTrayIcon: spec("shell", "Assert tray icon state.", { template: bool, frame: int(), tooltip: str, visible: bool }, { rule: anyKey("template", "frame", "tooltip", "visible") }),
  assertTaskbar: spec("shell", "Assert Windows taskbar state.", { progress: fraction, overlay: str }, { rule: anyKey("progress", "overlay") }),

  // Motion
  setClock: single("motion", "Switch the animation clock.", "mode", oneOf("virtual", "real"), {}, { driver: true }),
  advanceClock: single("motion", "Advance the virtual animation clock.", "duration", duration, {}, { driver: true }),
  captureMotion: spec("motion", "Record motion samples for a target.", { target: selector, until: { type: ["string", "integer"], pattern: "^(settled|\\d+(\\.\\d+)?(ms|s|m))$", minimum: 0, description: "settled, or a duration" }, name: str }, { required: ["target", "name"], driver: true }),
  assertMotion: spec("motion", "Assert motion of a target.", {
    target: selector, kind: oneOf("spring", "timing", "crossfade", "none"), velocityContinuous: bool, overshoot: bound(pixels), settlesWithin: duration,
    frames: obj({ at: list({ type: "number", minimum: 0, maximum: 100 }), golden: str }, ["at", "golden"]),
  }, { required: ["target"], driver: true }),
  interruptAt: spec("motion", "Run a command when the running motion reaches a progress point.", { target: selector, progress: fraction, with: command }, { required: ["progress", "with"], driver: true }),
  assertFrames: spec("motion", "Assert frame rate and drops while a command runs (real clock).", { during: command, fps: bound(num), dropped: int() }, { required: ["during"], rule: anyKey("fps", "dropped"), driver: true }),
  assertPaused: spec("motion", "Assert a target's animation pauses in a state. Its `when` is that state, so this command cannot take a condition; wrap it in runFlow { when, commands }.", { target: selector, when: oneOf("windowHidden", "appHidden", "minimized", "occluded", "inactive") }, { required: ["target", "when"], driver: true }),
  assertNoLayoutThrash: spec("motion", "Assert no repeated layout passes while a command runs.", { during: command }, { required: ["during"], driver: true }),

  // Visual
  takeScreenshot: single("visual", "Capture the app in-process (driver capture, no screen-recording permission).", "name", str, { window: windowSelector }, { maestro: true, driver: true }),
  assertScreenshot: single("visual", "Capture in-process and compare with golden/<platform>/<appearance>/<locale>/<golden>.png.", "golden", str, { window: windowSelector, threshold: percent, mask: list(selector) }, { driver: true }),
  startRecording: spec("visual", "Start a screen recording.", { name: str }),
  stopRecording: single("visual", "Stop and save the recording.", "name", str),
  assertNoFlicker: spec("visual", "Assert no blank or partial frames while a command runs.", { during: command }, { required: ["during"], driver: true }),
  assertPixelDiff: spec("visual", "Compare two captured screenshots.", { a: str, b: str, max: { type: ["string", "number"], pattern: "^\\d+(\\.\\d+)?%$", minimum: 0, description: "a pixel count or a percentage such as 0.5%" } }, { required: ["a", "b", "max"] }),

  // Accessibility
  assertA11y: spec("a11y", "Assert the accessibility properties of an element.", { id: str, label: text, role: str, value: anyStr, hint: text }, { required: ["id"], rule: anyKey("label", "role", "value", "hint") }),
  auditAccessibility: spec("a11y", "Run the platform accessibility audit.", { scope, maxErrors: int() }),
  voiceOver: single("a11y", "Turn the screen reader on or off.", "enable", bool),
  screenReaderNext: spec("a11y", "Move the screen reader to the next element."),
  assertSpoken: single("a11y", "Assert the last screen-reader output.", "text", text),
  assertAnnouncement: single("a11y", "Assert an accessibility announcement.", "text", text),
  assertCustomActions: spec("a11y", "Assert an element's custom accessibility actions.", { id: str, actions: list(str) }, { required: ["id", "actions"] }),
  assertKeyboardReachable: spec("a11y", "Assert every interactive element is reachable with Tab / full keyboard access.", { scope }),

  // i18n
  assertNoTruncation: spec("i18n", "Assert no visible text is truncated.", { scope }),
  assertMirrored: onTarget("i18n", "Assert an element is mirrored for right-to-left layout."),
  assertFormatted: spec("i18n", "Assert locale-formatted text.", { id: str, equals: str }, { required: ["id", "equals"] }),
  assertLocalized: spec("i18n", "Assert no source-locale strings remain, including native menus and dialogs.", { scope, includeNative: bool }),

  // Performance
  measure: spec("performance", "Time a command sequence against a budget.", { name: str, run: commands, budget: duration }, { required: ["name", "run"], driver: true }),
  assertMemory: spec("performance", "Assert memory use.", { window: windowSelector, maxMB: num }, { required: ["maxMB"], driver: true }),
  assertIdleCpu: spec("performance", "Assert CPU use while idle.", { for: duration, maxPercent: num }, { required: ["for", "maxPercent"], driver: true }),
  assertNoLeaks: spec("performance", "Assert leak counters (windows, views, listeners, native handles) return to baseline.", { since: oneOf("flowStart", "mark"), repeat: int(1), run: commands }, { rule: anyKey("since", "run"), driver: true }),
  startTrace: spec("performance", "Start a performance trace.", { name: str }, { driver: true }),
  stopTrace: single("performance", "Stop and save the trace.", "name", str, {}, { driver: true }),
  assertEnergy: single("performance", "Assert energy impact.", "maxImpact", oneOf("low", "medium", "high"), {}, { driver: true }),

  // Network / processes / updates
  mockNetwork: spec("network", "Serve a fixture for matching requests.", { route: str, fixture: str, latency: duration }, { required: ["route"] }),
  assertRequest: spec("network", "Assert requests were made.", { url: str, method: oneOf("GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"), count: int() }, { required: ["url"] }),
  serveAppcast: single("network", "Serve an update appcast fixture.", "fixture", str),
  assertProcess: spec("network", "Assert a helper process state.", { name: str, running: bool }, { required: ["name", "running"] }),
  killProcess: single("network", "Kill a helper process.", "name", str),

  // State introspection (discouraged; prefer black-box)
  assertState: spec("state", "Assert app state by path.", { path: str, equals: anyValue }, { required: ["path", "equals"], driver: true }),

  // Control flow
  runFlow: spec("control", "Run a subflow file, or inline commands.", { file: str, env: dict(anyStr), commands }, { shorthand: "file", rule: oneKey("file", "commands"), maestro: true }),
  repeat: spec("control", "Repeat commands a number of times and/or while a condition holds.", { times: int(1), while: condition, commands }, { required: ["commands"], rule: anyKey("times", "while"), maestro: true }),
  extendedWaitUntil: spec("control", "Wait until a target is visible or gone.", { visible: selector, notVisible: selector }, { rule: oneKey("visible", "notVisible"), maestro: true }),
  runScript: single("control", "Run a sandboxed JS file; for fixture generation only.", "file", str, { env: dict(anyStr) }, { maestro: true }),

  // Manual steps
  manualStep: spec("manual", "A step a person performs and signs off.", { instruction: str, expect: str, evidence: oneOf("screenshot", "recording", "none"), signoff: oneOf("required", "optional") }, { required: ["instruction", "expect"] }),
};

/** Commands that may be written with no value at all: `- launchApp`. */
export const isBare = (spec: CommandSpec) => !spec.required?.length && !spec.rule;
