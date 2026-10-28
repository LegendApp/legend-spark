// The Spark in-app driver (docs/test-driver.md) as a runner backend: white-box, in-process, macOS
// (docs/e2e-flows.md#the-driver-backend). Commands it cannot serve are missing from `commands`, so the runner fails
// them as unsupported; OS input and the accessibility tree belong to the black-box backend (#50).
import { copyFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { processLog, type ProcessLog } from "../../../packages/cli/src/process.ts";
import { DriverError, type Capture as DriverCapture, type DriverWindow, type Frame, type PointerEvents } from "../driver.ts";
import { Failure, type Artifact, type Atom, type AtomKey, type Backend, type Capture, type CommandHandler, type Element, type QueryScope, type Session } from "./backend.ts";

/** What the backend uses of a driver session (`Driver` in scripts/e2e/driver.ts). Tests pass a double. */
export type DriverClient = {
  readonly running: boolean;
  pointerEvents(window: DriverWindow, point: { x: number; y: number }): Promise<PointerEvents>;
  navigate(url: string): Promise<void>;
  openFile(file: string): Promise<void>;
  waitFor(testID: string, timeoutMs?: number): Promise<{ window: string; frame: Frame }>;
  setAppAppearance(appearance: "light" | "dark", timeoutMs?: number): Promise<{ changed: boolean }>;
  capture(window: DriverWindow, name: string): Promise<DriverCapture>;
  quit(): Promise<void>;
  close(): Promise<void>;
};
/** The app under test (`KitchenSinkApp` in scripts/e2e/kitchen-sink.ts): prepared per flow, launched in driver mode. */
export type DriverApp = {
  open(): Promise<{ app: string; bundleId: string }>;
  /** Launch arguments and environment variables the launch sets itself, so a flow may not; `locale` only when the matrix sets one. */
  readonly reserved: { readonly arguments: readonly string[]; readonly env: readonly string[]; readonly locale: readonly string[] };
  /** Deletes the app's persisted state (docs/e2e-flows.md#clearstate) while it is not running; returns what existed. */
  clearState(): Promise<string[]>;
  launch(options: { locale?: string; arguments: readonly string[]; env: Readonly<Record<string, string>>; log: ProcessLog }): Promise<DriverClient>;
  close(): Promise<void>;
};

const LAUNCH_KEYS = new Set(["clearState", "arguments", "env", "openFile", "openUrl", "stopApp"]);
const FRESH_KEYS = ["clearState", "arguments", "env"];
/** The first render includes loading JavaScript, so the matrix appearance waits longer than an in-flow change. */
const LAUNCH_APPEARANCE_MS = 30000;

export class DriverBackend implements Backend {
  readonly name = "driver";
  readonly kind = "driver";
  readonly platform = "macos";
  /** `appearance` through setAppAppearance after each launch; `locale` through launch arguments. */
  readonly matrix: ReadonlySet<string> = new Set(["appearance", "locale"]);
  readonly queryKeys: ReadonlySet<AtomKey> = new Set(["id"]);
  readonly commands: Readonly<Record<string, CommandHandler>> = {
    launchApp: args => this.launchApp(args),
    stopApp: () => this.quit(),
    setAppAppearance: async args => { await this.client().setAppAppearance(args.appearance as "light" | "dark"); },
  };
  private session?: Session;
  private driver?: DriverClient;
  private logs: string[] = [];
  private launches = 0;
  private captures = 0;

  constructor(private readonly app: DriverApp) {}

  /** Used only by the opt-in OS pointer backend; ordinary driver runs stay hidden. */
  pointerEvents(window: DriverWindow, point: { x: number; y: number }) { return this.client().pointerEvents(window, point); }

  async start(session: Session) {
    this.session = session;
    this.logs = [];
    this.launches = 0;
    const { app, bundleId } = await this.app.open();
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
    }
    if (args.openUrl !== undefined) await this.driver!.navigate(String(args.openUrl));
    if (file !== undefined) await this.driver!.openFile(file);
  }

  /** Quits the app through its normal termination path, if it runs, and ends the session. */
  private async quit() {
    const driver = this.driver;
    this.driver = undefined;
    if (!driver) return;
    try { if (driver.running) await driver.quit(); } finally { await driver.close(); }
  }

  /** `id` only, through `waitFor` (an in-process testID search of every window); at most the first match. */
  async query(atom: Atom, scope: QueryScope): Promise<Element[]> {
    if (scope.within) throw new Failure("unsupported", "backend driver cannot select within an element");
    const id = atom.id!;
    try {
      const { window, frame } = await this.client().waitFor(id, 0);
      return scope.window === undefined || scope.window === window ? [{ key: `${window}#${id}`, window, id, frame }] : [];
    } catch (error) {
      if (error instanceof DriverError && error.code === "E_TIMEOUT") return [];
      throw error;
    }
  }

  /** The main window, rendered in-process. Element frames are points from its top-left, so the capture's frame starts at 0,0. */
  async screenshot(file: string): Promise<Capture> {
    const capture = await this.client().capture("main", `capture-${++this.captures}`);
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
