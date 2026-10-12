// The Spark in-app driver (docs/test-driver.md) as a runner backend: white-box, in-process, macOS
// (docs/e2e-flows.md#the-driver-backend). It selects through the app's in-process accessibility view and runs the
// black-box commands it implements (input, gestures, assertCursor, assertText, assertA11y, auditAccessibility) with in-process events when no black-box backend
// is active; the runner labels those steps white-box. Commands it cannot serve are missing from `commands`, so the
// runner fails them as unsupported; real OS input and the accessibility tree belong to the black-box backend (#50).
import { copyFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { processLog, type ProcessLog } from "../../../packages/cli/src/process.ts";
import { formatAccelerator, parseAccelerator } from "../../../packages/desktop-app/src/contracts/accelerator.ts";
import {
  DriverError, type Counters, type SimulatedSystemEvent, type Capture as DriverCapture, type DriverCursor, type DriverElement, type DriverMenuItem, type DriverWindow, type DriverWindowInfo,
  type Frame, type Gesture, type InputTarget, type Modifier, type MouseButton, type TestClipboard,
} from "../driver.ts";
import { readPng } from "../golden/diff.ts";
import { auditCommand, type AuditClient } from "./driver-audit.ts";
import { inspectCommands, type InspectClient } from "./driver-inspect.ts";
import { motionCommands, type MotionClient } from "./driver-motion.ts";
import { renderCommands, type RenderClient } from "./driver-render.ts";
import { ms } from "./executor.ts";
import { matchesText, parseSelector } from "./selectors.ts";
import {
  Failure, type Artifact, type Backend, type Capture, type CommandContext, type CommandHandler, type Element, type Session, type Target, type WindowInfo,
} from "./backend.ts";

/** What the backend uses of a driver session (`Driver` in scripts/e2e/driver.ts). Tests pass a double. */
export type DriverClient = MotionClient & InspectClient & RenderClient & AuditClient & {
  readonly running: boolean;
  navigate(url: string): Promise<void>;
  openFile(file: string): Promise<void>;
  setAppAppearance(appearance: "light" | "dark", timeoutMs?: number): Promise<{ changed: boolean }>;
  capture(window: DriverWindow, name: string): Promise<DriverCapture>;
  setClock(mode: "virtual" | "real"): Promise<unknown>;
  advanceClock(durationMs: number): Promise<unknown>;
  simulateSystemEvent(event: SimulatedSystemEvent): Promise<void>;
  simulateDisplays(displays: readonly object[] | null): Promise<void>;
  setTestClipboard(content: { text?: string; html?: string; concealed?: boolean }): Promise<void>;
  testClipboard(): Promise<TestClipboard>;
  elements(): Promise<{ windows: DriverWindowInfo[]; elements: DriverElement[] }>;
  tap(target: InputTarget, options?: { button?: MouseButton; clickCount?: number; modifiers?: Modifier[] }): Promise<void>;
  gesture(target: InputTarget, gesture: Gesture, modifiers?: Modifier[]): Promise<void>;
  cursor(target?: InputTarget): Promise<DriverCursor>;
  hover(target: InputTarget): Promise<void>;
  drag(from: InputTarget, to: InputTarget, options?: { steps?: number; modifiers?: Modifier[] }): Promise<void>;
  scroll(target: InputTarget, delta: { deltaX?: number; deltaY?: number; precise?: boolean }): Promise<void>;
  pressKey(key: string, modifiers?: Modifier[]): Promise<void>;
  typeText(text: string): Promise<void>;
  menus(): Promise<DriverMenuItem[]>;
  quit(): Promise<void>;
  close(): Promise<void>;
};
/** The app under test (`KitchenSinkApp` in scripts/e2e/kitchen-sink.ts): prepared per flow, launched in driver mode. */
export type DriverApp = {
  /** `dev`: a `build: dev` flow, which needs the development JavaScript bundle (only a dev build can load one). */
  open(options: { dev: boolean }): Promise<{ app: string; bundleId: string; launchedBundleId: string }>;
  /** Launch arguments and environment variables the launch sets itself, so a flow may not; `locale` only when the matrix sets one. */
  readonly reserved: { readonly arguments: readonly string[]; readonly env: readonly string[]; readonly locale: readonly string[] };
  /** Deletes the state of the driver session (docs/e2e-flows.md#app-state) while the app is not running; returns what existed. */
  clearState(): Promise<string[]>;
  /** Snapshots `keys` of the defaults domain the app runs under, refusing while it runs; the result restores them (docs/e2e-flows.md#preserveappdefaults). */
  preserveDefaults(keys: readonly string[]): Promise<() => void>;
  launch(options: { locale?: string; arguments: readonly string[]; env: Readonly<Record<string, string>>; log: ProcessLog }): Promise<DriverClient>;
  close(): Promise<void>;
};

const LAUNCH_KEYS = new Set(["clearState", "arguments", "env", "openFile", "openUrl", "stopApp"]);
const FRESH_KEYS = ["clearState", "arguments", "env"];
/** NSEventModifierFlags bits (parseAccelerator) to driver modifier names. Caps Lock is not a key the driver presses. */
const MODIFIER_BITS: Array<[number, Modifier]> = [[1 << 20, "cmd"], [1 << 18, "ctrl"], [1 << 19, "option"], [1 << 17, "shift"], [1 << 23, "fn"]];
/** scroll without `amount`: points when precise, else lines. */
const SCROLL_AMOUNT = { precise: 100, lines: 3 };
/** The first render includes loading JavaScript, so the matrix appearance waits longer than an in-flow change. */
const LAUNCH_APPEARANCE_MS = 30000;

export class DriverBackend implements Backend {
  readonly name = "driver";
  readonly kind = "driver";
  readonly platform = "macos";
  /** `appearance` through setAppAppearance after each launch; `locale` through launch arguments. */
  readonly matrix: ReadonlySet<string> = new Set(["appearance", "locale"]);
  readonly commands: Readonly<Record<string, CommandHandler>> = this.baselined({
    launchApp: args => this.launchApp(args),
    stopApp: () => this.quit(),
    preserveAppDefaults: (args, context) => this.preserveAppDefaults(args, context),
    setAppAppearance: async args => { await this.client().setAppAppearance(args.appearance as "light" | "dark"); },
    // The motion engine's virtual clock (docs/motion.md#virtual-clock-for-the-test-driver).
    setClock: async args => { await this.client().setClock(args.mode as "virtual" | "real"); },
    advanceClock: async args => { await this.client().advanceClock(ms(args.duration as string | number)); },
    // The system module's injected events and state (docs/system.md#testing-system-events).
    simulateSystemEvent: async args => { await this.client().simulateSystemEvent(args as SimulatedSystemEvent); },
    // Motion telemetry and frame counters (docs/e2e-flows.md#motion-and-frames).
    ...motionCommands(() => this.client()),
    // The display source of @legendapp/spark/displays (docs/displays.md#simulated-displays).
    simulateDisplays: async args => { await this.client().simulateDisplays(args.restore ? null : args.displays as object[]); },
    // The app's private test pasteboard, never the user's clipboard (docs/clipboard.md#testing).
    setClipboard: async args => { await this.client().setTestClipboard(args as { text?: string; html?: string; concealed?: boolean }); },
    assertClipboard: (args, context) => context.eventually(async () => assertClipboard(await this.client().testClipboard(), args)),
    // Startup phases and the state the app exposes (docs/e2e-flows.md#app-inspection).
    ...inspectCommands(() => this.client()),
    // Layout thrash, flicker, leak counters and memory (docs/e2e-flows.md#layout-flicker-and-leaks).
    ...renderCommands(() => this.client(), () => this.launchCounters),
    // Black-box commands, run here in-process (white-box) only when no black-box backend is active.
    tapOn: (args, context) => this.click(args, context, {}),
    doubleClickOn: (args, context) => this.click(args, context, { clickCount: 2 }),
    tripleClickOn: (args, context) => this.click(args, context, { clickCount: 3 }),
    rightClickOn: (args, context) => this.click(args, context, { button: "right" }),
    // Mouse buttons 3 and 4, and trackpad gestures, as AppKit delivers them (docs/test-driver.md#input).
    mouseButton: async (args, context) => {
      if (args.on === undefined) throw new Failure("unsupported", "backend driver presses a mouse button only `on` a target");
      await this.client().tap(this.input(await context.resolve(args.on)), { button: args.button as MouseButton });
    },
    forceClickOn: async (args, context) => { await this.client().gesture(this.input(await context.target()), { kind: "pressure", stage: 2 }, this.modifiers(args).modifiers); },
    smartZoomOn: async (_args, context) => { await this.client().gesture(this.input(await context.target()), { kind: "smartMagnify" }); },
    pinch: async (args, context) => {
      const scale = args.scale as number;
      if (!(scale > 0) || scale === 1) throw new Failure("invalid", "pinch scale is a positive factor other than 1");
      await this.client().gesture(await this.on("pinch", args, context), { kind: "magnify", magnification: scale - 1 });
    },
    // Flow degrees are clockwise, as React Native's rotate transform; AppKit's rotation is counterclockwise.
    rotate: async (args, context) => {
      if (args.degrees === 0) throw new Failure("invalid", "rotate degrees are nonzero");
      await this.client().gesture(await this.on("rotate", args, context), { kind: "rotate", rotation: -(args.degrees as number) });
    },
    assertCursor: (args, context) => this.assertCursor(args, context),
    hoverOn: async (args, context) => {
      this.unsupported("hoverOn", args, ["duration"]);
      await this.client().hover(this.input(await context.target()));
    },
    inputText: (args, context) => this.type(args, context),
    typeText: (args, context) => this.type(args, context),
    pressKey: async args => this.press(String(args.key)),
    shortcut: async args => this.press(String(args.keys)),
    scroll: (args, context) => this.scroll(args, context),
    swipe: (args, context) => this.swipe(args, context),
    dragAndDrop: async (args, context) => {
      this.unsupported("dragAndDrop", args, ["holdAt"]);
      const from = await context.resolve(args.from), to = await context.resolve(args.to);
      if (from.element.window !== to.element.window) throw new Failure("unsupported", "backend driver drags only within one window");
      await this.client().drag(this.input(from), this.input(to), { ...(args.steps === undefined ? {} : { steps: args.steps as number }), ...this.modifiers(args) });
    },
    assertText: (args, context) => this.assertText(args, context),
    assertA11y: (args, context) => this.assertA11y(args, context),
    // The macOS accessibility audit rules that need no assistive-technology client, judged from in-process facts.
    auditAccessibility: auditCommand(() => this.client(), readPng),
    // White-box: the menu bar as AppKit holds it, validated as when a user opens it (assertMenuItem is the black-box form).
    assertAppMenu: (args, context) => context.eventually(async () => assertMenu(await this.client().menus(), args)),
  });
  private session?: Session;
  private driver?: DriverClient;
  private logs: string[] = [];
  private launches = 0;
  private captures = 0;
  /**
   * Leak counters of the running launch before the flow's first command on it other than launchApp (visibility checks
   * are the runner's), once the UI settled: taken only for a flow with assertNoLeaks since: flowStart.
   */
  private launchCounters?: Counters;
  private countsLaunches = false;
  private launchCountersDue = false;

  constructor(private readonly app: DriverApp) {}

  async start(session: Session) {
    this.session = session;
    this.logs = [];
    this.launches = 0;
    this.countsLaunches = usesLaunchCounters(session.flow);
    const { app, bundleId } = await this.app.open({ dev: session.flow.header.build === "dev" });
    if (session.flow.header.appId === bundleId) return;
    await this.app.close(); // The runner stops only backends that started.
    throw new Failure("invalid", `the flow is for ${session.flow.header.appId}, but ${app} is ${bundleId}`);
  }

  async stop() {
    try { await this.quit(); } finally {
      this.session = undefined;
      await this.app.close();
    }
  }

  /** Takes the launch's leak counters, when due, before every command other than launchApp and stopApp. */
  private baselined(handlers: Record<string, CommandHandler>): Record<string, CommandHandler> {
    return Object.fromEntries(Object.entries(handlers).map(([name, handler]) => [name, name === "launchApp" || name === "stopApp" ? handler : async (args, context) => {
      if (this.launchCountersDue) {
        this.launchCountersDue = false;
        this.launchCounters = await this.client().counters();
      }
      await handler(args, context);
    }]));
  }

  /** The running app's driver session. */
  private client(): DriverClient {
    if (this.driver?.running) return this.driver;
    if (this.driver) throw new Failure("error", `the app exited; see ${this.logs.at(-1)}`);
    throw new Failure("invalid", "the app is not running; start the flow with launchApp");
  }

  /**
   * Launches in driver mode (restarting a running app unless `stopApp: false`), after deleting the app's state for
   * `clearState: true`, with the flow's `arguments` and `env`. Then delivers `openUrl` with `navigate` and `openFile`
   * with `openFile`.
   */
  private async launchApp(args: Record<string, unknown>) {
    const unsupported = Object.keys(args).filter(key => !LAUNCH_KEYS.has(key));
    if (unsupported.length) throw new Failure("unsupported", `launchApp ${unsupported.join(", ")} is not supported by backend driver`);
    const { matrix, dir } = this.session!;
    const locale = matrix.locale as string | undefined;
    const argv = (args.arguments ?? []) as string[], env = (args.env ?? {}) as Record<string, string>, file = args.openFile as string | undefined;
    const relaunch = args.stopApp !== false || !this.driver?.running;
    const fresh = FRESH_KEYS.filter(key => args[key] !== undefined);
    if (!relaunch && fresh.length) throw new Failure("invalid", `launchApp ${fresh.join(", ")} need a new launch, but stopApp: false keeps the running app`);
    const reserved = this.app.reserved, flags = new Set([...reserved.arguments, ...(locale === undefined ? [] : reserved.locale)]);
    const taken = [...argv.filter(arg => flags.has(arg)), ...Object.keys(env).filter(name => reserved.env.includes(name))];
    if (taken.length) throw new Failure("invalid", `launchApp ${taken.join(", ")} ${taken.length === 1 ? "is" : "are"} reserved by backend driver`);
    if (file !== undefined && !(path.isAbsolute(file) && existsSync(file))) throw new Failure("invalid", `launchApp openFile ${file} is not an absolute path to an existing file`);
    if (relaunch) {
      await this.quit();
      const launch = ++this.launches;
      if (args.clearState === true) {
        const cleared = path.join(dir, `clear-state-${launch}.log`);
        writeFileSync(cleared, (await this.app.clearState()).map(item => `${item}\n`).join(""));
        this.logs.push(cleared);
      }
      const log = path.join(dir, `app-${launch}.log`);
      this.logs.push(log);
      this.driver = await this.app.launch({ locale, arguments: argv, env, log: processLog(log) });
      if (matrix.appearance !== undefined) await this.driver.setAppAppearance(matrix.appearance as "light" | "dark", LAUNCH_APPEARANCE_MS);
      this.launchCounters = undefined;
      this.launchCountersDue = this.countsLaunches;
    }
    if (args.openUrl !== undefined) await this.driver!.navigate(String(args.openUrl));
    if (file !== undefined) await this.driver!.openFile(file);
  }

  /**
   * Registers a runner restore, which runs after onFlowComplete and outside the flow's timeout: it quits the app (so it
   * cannot write the values back) and then writes the snapshot back, even when quitting failed.
   */
  private async preserveAppDefaults(args: Record<string, unknown>, context: CommandContext) {
    const keys = (Array.isArray(args.keys) ? args.keys : [args.keys]).map(String);
    if (this.driver?.running) throw new Failure("invalid", "preserveAppDefaults runs before launchApp: the app is running");
    let restore: () => void;
    try { restore = await this.app.preserveDefaults(keys); } catch (error) { throw new Failure("invalid", (error as Error).message); }
    context.onRestore(`app defaults ${keys.join(", ")}`, async () => { try { await this.quit(); } finally { restore(); } });
  }

  /** Quits the app through its normal termination path, if it runs, and ends the session. */
  private async quit() {
    const driver = this.driver;
    this.driver = undefined;
    if (!driver) return;
    try { if (driver.running) await driver.quit(); } finally { await driver.close(); }
  }

  /** Every element of the in-process accessibility view (`elements`): the runner matches every selector key against it. */
  async elements(): Promise<Element[]> { return (await this.client().elements()).elements; }
  /** The app's windows with identifiers, front to back; each frame is the window in its own element coordinates. */
  async windows(): Promise<WindowInfo[]> { return (await this.client().elements()).windows; }

  private unsupported(command: string, args: Record<string, unknown>, keys: string[]) {
    const used = keys.filter(key => args[key] !== undefined);
    if (used.length) throw new Failure("unsupported", `${command} ${used.join(", ")} is not supported by backend driver`);
  }
  /**
   * A resolved target as driver input: by testID with the point as an offset, which the driver scrolls into view and
   * hit-checks; or the point (waitFor frame coordinates) in its window.
   */
  private input({ element, point }: Target): InputTarget {
    if (element.id) return { testID: element.id, offset: { x: point.x - element.frame.x, y: point.y - element.frame.y } };
    if (!element.window) throw new Failure("unsupported", `backend driver cannot address the window of ${JSON.stringify(element.key)}: it has no identifier`);
    return { point, window: `id:${element.window}` };
  }
  private modifiers(args: Record<string, unknown>) {
    return args.modifiers === undefined ? {} : { modifiers: (args.modifiers as string[]).map(name => (name === "alt" ? "option" : name) as Modifier) };
  }
  private async click(args: Record<string, unknown>, context: CommandContext, options: { button?: MouseButton; clickCount?: number }) {
    await this.client().tap(this.input(await context.target()), { ...options, ...this.modifiers(args) });
  }
  /** `into` is clicked first (focusing it); then one key press per character. inputText types too: the driver has no one-step insert. */
  private async type(args: Record<string, unknown>, context: CommandContext) {
    if (args.into !== undefined) await this.client().tap(this.input(await context.resolve(args.into)));
    await this.client().typeText(String(args.text));
  }
  /** An accelerator such as `Escape` or `cmd+shift+s`, pressed in the window of the last pointer input. */
  private async press(accelerator: string) {
    const { key, modifiers } = parseAccelerator(accelerator, "macos", { allowUnmodifiedCharacter: true, allowExtendedKeys: true });
    if (key.length !== 1 || modifiers & (1 << 16)) throw new Failure("unsupported", `backend driver cannot press ${accelerator}`);
    await this.client().pressKey(key, MODIFIER_BITS.filter(([bit]) => modifiers & bit).map(([, name]) => name));
  }
  /** `amount` in points when precise, else lines; `down` and `right` scroll toward the end of the content. */
  private async scroll(args: Record<string, unknown>, context: CommandContext) {
    this.unsupported("scroll", args, ["momentum"]);
    if (args.on === undefined) throw new Failure("unsupported", "backend driver scrolls only `on` a target");
    const precise = args.precise === true, amount = (args.amount as number | undefined) ?? (precise ? SCROLL_AMOUNT.precise : SCROLL_AMOUNT.lines);
    const direction = (args.direction as string | undefined) ?? "down";
    const sign = direction === "down" || direction === "right" ? 1 : -1;
    await this.client().scroll(this.input(await context.resolve(args.on)), { [direction === "up" || direction === "down" ? "deltaY" : "deltaX"]: sign * amount, precise });
  }
  /**
   * A one- or two-finger swipe as a precise scroll over `from` by the fingers' travel, content following the fingers: from
   * `start` to `end` (points in `from`), or half of `from` in `direction`. Three fingers are AppKit's swipe gesture
   * (swipeWithEvent:) in `direction`.
   */
  private async swipe(args: Record<string, unknown>, context: CommandContext) {
    this.unsupported("swipe", args, ["duration"]);
    if (args.from === undefined) throw new Failure("unsupported", "backend driver swipes only `from` a target");
    const fingers = args.fingers as number | undefined ?? 1;
    if (fingers > 3) throw new Failure("unsupported", "backend driver swipes with one or two fingers (a scroll) or three (a swipe gesture)");
    const from = await context.resolve(args.from);
    if (fingers === 3) {
      if (args.direction === undefined) throw new Failure("unsupported", "backend driver swipes three fingers only in a `direction`");
      await this.client().gesture(this.input(from), { kind: "swipe", direction: args.direction as "left" | "right" | "up" | "down" });
      return;
    }
    let travel: { x: number; y: number };
    if (args.start !== undefined) {
      const start = await context.resolve({ point: args.start, within: args.from }), end = await context.resolve({ point: args.end ?? args.start, within: args.from });
      travel = { x: end.point.x - start.point.x, y: end.point.y - start.point.y };
    } else {
      const { width, height } = from.element.frame, direction = args.direction as string;
      travel = { x: direction === "left" ? -width / 2 : direction === "right" ? width / 2 : 0, y: direction === "up" ? -height / 2 : direction === "down" ? height / 2 : 0 };
    }
    await this.client().scroll(this.input(from), { deltaX: -travel.x, deltaY: -travel.y, precise: true });
  }
  private async on(command: string, args: Record<string, unknown>, context: CommandContext): Promise<InputTarget> {
    if (args.on === undefined) throw new Failure("unsupported", `backend driver performs ${command} only \`on\` a target`);
    return this.input(await context.resolve(args.on));
  }
  /**
   * `on` moves the driver's pointer onto the target first, which ends a cursor hidden until the pointer moves. `hidden`
   * asserts that hiding; any other name is the shape AppKit would show, which hiding fails.
   */
  private async assertCursor(args: Record<string, unknown>, context: CommandContext) {
    if (args.on !== undefined) await this.client().hover(this.input(await context.resolve(args.on)));
    const expected = String(args.cursor);
    await context.eventually(async () => {
      const { cursor, hiddenUntilMoved } = await this.client().cursor();
      const actual = hiddenUntilMoved ? "hidden" : cursor;
      if (actual !== expected) throw new Failure("assertion", `the cursor is ${actual}${hiddenUntilMoved ? ` (${cursor} once the pointer moves)` : ""}, not ${expected}`);
    });
  }
  /** The one element with this testID in the in-process accessibility view. */
  private async element(id: string): Promise<DriverElement> {
    const found = (await this.client().elements()).elements.filter(element => element.id === id);
    if (found.length !== 1) throw new Failure(found.length ? "ambiguous" : "not-found", `${JSON.stringify({ id })} matched ${found.length} elements; it must match one`);
    return found[0]!;
  }
  /** The element's text (string value, title, or displayed text) in the in-process accessibility view. */
  private async assertText(args: Record<string, unknown>, context: CommandContext) {
    this.unsupported("assertText", args, ["lineEndings"]);
    const id = String(args.id), equals = String(args.equals);
    await context.eventually(async () => {
      const { text } = await this.element(id);
      if (text !== equals) throw new Failure("assertion", `the text of ${JSON.stringify({ id })} is ${JSON.stringify(text ?? null)}, not ${JSON.stringify(equals)}`);
    });
  }
  /** `label`, `role` and `value` of the element as NSAccessibility reports them in-process; `label` matches like a selector's. */
  private async assertA11y(args: Record<string, unknown>, context: CommandContext) {
    this.unsupported("assertA11y", args, ["hint"]);
    const id = String(args.id), label = args.label === undefined ? undefined : parseSelector({ label: args.label }, context.platform).atom.label!;
    await context.eventually(async () => {
      const element = await this.element(id);
      if (label && !matchesText(label, element.label)) throw new Failure("assertion", `the accessibility label of ${JSON.stringify({ id })} is ${JSON.stringify(element.label ?? null)}, not ${JSON.stringify(args.label)}`);
      if (args.role !== undefined && element.role !== args.role) throw new Failure("assertion", `the accessibility role of ${JSON.stringify({ id })} is ${JSON.stringify(element.role ?? null)}, not ${JSON.stringify(args.role)}`);
      if (args.value !== undefined && element.value !== args.value) throw new Failure("assertion", `the accessibility value of ${JSON.stringify({ id })} is ${JSON.stringify(element.value ?? null)}, not ${JSON.stringify(args.value)}`);
    });
  }

  /** The window (the main window by default), rendered in-process. Element frames are points from its top-left, so the capture's frame starts at 0,0. */
  async screenshot(file: string, window?: WindowInfo): Promise<Capture> {
    const capture = await this.client().capture(window ? `id:${window.id}` : "main", `capture-${++this.captures}`);
    copyFileSync(capture.file, file);
    return { frame: { x: 0, y: 0, width: capture.width / capture.scale, height: capture.height / capture.scale }, scale: capture.scale };
  }

  /** The app logs of this flow and, while the app runs, a capture of the main window. */
  async collect(dir: string): Promise<Artifact[]> {
    const artifacts: Artifact[] = this.logs.map(log => ({ kind: "logs", path: log }));
    if (!this.driver?.running) return artifacts;
    const file = path.join(dir, "driver-main.png");
    await this.screenshot(file);
    return [...artifacts, { kind: "screenshot", path: file }];
  }
}

/** Whether any command, nested ones included, is `assertNoLeaks` with `since: flowStart`. */
function usesLaunchCounters(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(usesLaunchCounters);
  if (!value || typeof value !== "object") return false;
  const command = value as { name?: unknown; args?: Record<string, unknown> };
  if (command.name === "assertNoLeaks" && command.args?.since === "flowStart") return true;
  return Object.values(value).some(usesLaunchCounters);
}

const titleOf = (item: DriverMenuItem) => item.separator ? "" : item.title.trim();
/** `path` is titles joined by " > " ("Developer > Reload"); every other key that is present must match. */
export function assertMenu(menus: readonly DriverMenuItem[], args: Record<string, unknown>) {
  const path = String(args.path), titles = path.split(" > ").map(title => title.trim());
  let items: readonly DriverMenuItem[] | undefined = menus, item: DriverMenuItem | undefined;
  for (const title of titles) {
    item = items?.find(candidate => titleOf(candidate) === title);
    if (!item || item.separator) {
      if (args.exists === false) return;
      throw new Failure("assertion", `no menu item ${path}: "${title}" is not in [${(items ?? []).filter(candidate => !candidate.separator).map(titleOf).join(", ")}]`);
    }
    items = item.items;
  }
  const found = item as Exclude<DriverMenuItem, { separator: true }>;
  if (args.exists === false) throw new Failure("assertion", `menu item ${path} exists`);
  const fail = (what: string, expected: unknown, actual: unknown) => { throw new Failure("assertion", `menu item ${path}: expected ${what} ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); };
  if (args.enabled !== undefined && found.enabled !== args.enabled) fail("enabled", args.enabled, found.enabled);
  if (args.hidden !== undefined && found.hidden !== args.hidden) fail("hidden", args.hidden, found.hidden);
  if (args.checked !== undefined && (found.state === "on") !== args.checked) fail("checked", args.checked, found.state);
  if (args.toolTip !== undefined && found.toolTip !== args.toolTip) fail("toolTip", args.toolTip, found.toolTip ?? null);
  if (args.shortcut !== undefined) {
    const actual = found.shortcut ? formatAccelerator({ key: found.shortcut.key.toLowerCase(), modifiers: found.shortcut.modifiers }) : null;
    const expected = formatAccelerator(parseAccelerator(String(args.shortcut), "macos", { allowUnmodifiedCharacter: true, allowExtendedKeys: true }));
    if (actual !== expected) fail("shortcut", expected, actual);
  }
}
/** Every listed type is on the test pasteboard (others may be too), and its plain text is exactly `text`. */
export function assertClipboard(clipboard: TestClipboard, args: Record<string, unknown>) {
  const missing = ((args.types as string[] | undefined) ?? []).filter(type => !clipboard.types.includes(type));
  if (missing.length) throw new Failure("assertion", `clipboard lacks ${missing.join(", ")}; it has [${clipboard.types.join(", ")}]`);
  if (args.text !== undefined && clipboard.text !== args.text) throw new Failure("assertion", `clipboard text is ${JSON.stringify(clipboard.text)}, expected ${JSON.stringify(args.text)}`);
}
