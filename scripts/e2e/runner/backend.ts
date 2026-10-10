// The contract between the flow runner and the backends that drive an app (docs/e2e-flows.md#backends).
import type { FlowAst, FlowCommand } from "../format/parser.ts";

export type Platform = "macos" | "windows";
export type Matrix = Record<string, string | boolean>;
export type Rect = { x: number; y: number; width: number; height: number };
export type Point = { x: number; y: number };

/** One visible UI element in screen coordinates. `key` is unique within a snapshot; `parent` is its parent's key. */
export type Element = { key: string; parent?: string; window: string; id?: string; role?: string; label?: string; text?: string; frame: Rect };
/** A window of the app. Backends list windows front to back; a window selector's `index` counts in that order. */
export type WindowInfo = { id: string; title: string; type?: string; key: boolean; main: boolean; frame: Rect };
export type TextMatch = { kind: "text"; value: string } | { kind: "regex"; source: string };
/** The attributes a backend matches on one element. An empty atom matches every element. */
export type Atom = { id?: string; role?: string; label?: TextMatch; text?: TextMatch };
export type AtomKey = keyof Atom;
export type QueryScope = { window?: string; within?: Element };
/** A resolved target: the element and the point to act on (its center, or the selector's `point`). */
export type Target = { element: Element; point: Point };

export type ArtifactKind = "screenshot" | "elements" | "logs" | "trace" | "recording" | "output";
export type Artifact = { kind: ArtifactKind; path: string; backend?: string };

export type Session = {
  flow: FlowAst;
  matrix: Matrix;
  platform: Platform;
  /** The app under test (`--app`), when given. */
  app?: string;
  /** A private directory for this backend in this flow execution (logs, scratch files). */
  dir: string;
};

/** What the runner gives a command handler. Waits use the command's timeout (default 5s). */
export type CommandContext = {
  command: FlowCommand;
  timeoutMs: number;
  platform: Platform;
  matrix: Matrix;
  /** Where a command writes files the flow asks for (takeScreenshot); they are listed as `output` artifacts. */
  outputDir: string;
  /** Waits until a selector matches exactly one element of this backend, then returns it. */
  resolve(selector: unknown): Promise<Target>;
  /** `resolve` for the command's own selector keys (tapOn, assertFocused, …). */
  target(): Promise<Target>;
  /** Waits until a window selector (`key`, `main`, `{ title, index, type, id }`) matches exactly one window of this backend. */
  window(selector: unknown): Promise<WindowInfo>;
  /** Runs `check` until it stops throwing a retryable Failure ("assertion", "not-found", "ambiguous"), or the timeout passes. Never use it for actions. */
  eventually<T>(check: () => Promise<T>): Promise<T>;
  /** Registers an undo for OS or app state this command changed. The runner runs undos last-in first-out when the flow exits, also on failure. */
  onRestore(label: string, undo: () => Promise<void>): void;
  /** Runs nested commands (measure.run, assertFrames.during, …) with the runner's semantics. */
  run(commands: FlowCommand[]): Promise<void>;
  addArtifact(artifact: Artifact): void;
};

export type CommandHandler = (args: Record<string, unknown>, context: CommandContext) => Promise<void>;

/**
 * A way of driving the app. `black-box` backends use OS input and the accessibility tree; `driver` backends work
 * inside the app process. Commands marked `driver` in the catalog run only on driver backends; other commands run
 * only on black-box backends, except lifecycle commands, which either kind may own.
 */
export interface Backend {
  readonly name: string;
  readonly kind: "black-box" | "driver";
  readonly platform: Platform;
  /** Matrix dimensions this backend applies to the app (for example at launch). Every dimension a flow uses needs one. */
  readonly matrix: ReadonlySet<string>;
  /** The dispatch table. A command missing here is reported as unsupported by this backend, never skipped. */
  readonly commands: Readonly<Record<string, CommandHandler>>;
  start(session: Session): Promise<void>;
  stop(): Promise<void>;
  /** Every visible element. With it, the runner matches selectors itself and can list nearby candidates and dump the tree. */
  elements?(): Promise<Element[]>;
  /** Native lookup, for backends that cannot list elements. Only atom keys in `queryKeys` are passed. */
  query?(atom: Atom, scope: QueryScope): Promise<Element[]>;
  readonly queryKeys?: ReadonlySet<AtomKey>;
  windows?(): Promise<WindowInfo[]>;
  /** Writes failure evidence it can produce (screenshot, logs, driver trace) into `dir`. */
  collect?(dir: string): Promise<Artifact[]>;
}

export type BackendFactory = (options: { app?: string }) => Backend;

export type FailureKind =
  | "assertion" | "not-found" | "ambiguous" | "unsupported" | "invalid" | "timeout" | "interrupted" | "restore" | "format" | "error";
/** A candidate shown when a selector does not match: an element whose attributes are close to the selector's. */
export type Candidate = Omit<Element, "key" | "parent">;

/** A typed flow failure. Handlers throw `new Failure("assertion", …)` when what they check is not true. */
export class Failure extends Error {
  constructor(readonly kind: FailureKind, message: string, readonly details: { candidates?: Candidate[]; matches?: Candidate[] } = {}) {
    super(message);
    this.name = "Failure";
  }
}

export const RETRYABLE: ReadonlySet<FailureKind> = new Set(["assertion", "not-found", "ambiguous"]);
