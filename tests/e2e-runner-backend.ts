// Test double for the e2e runner: an in-memory app on a virtual clock. Not a production backend.
import { writeFileSync } from "node:fs";
import path from "node:path";
import type { Artifact, Backend, CommandHandler, Element, Platform, Session, WindowInfo } from "../scripts/e2e/runner/backend.ts";
import type { Clock } from "../scripts/e2e/runner/executor.ts";

export class VirtualClock implements Clock {
  time = 0;
  now() { return this.time; }
  async sleep(ms: number) { this.time += ms; }
}

/** An element that is visible from `from` (ms) until `until`. */
export type TimedElement = Element & { from?: number; until?: number };
export const element = (key: string, attributes: Partial<TimedElement> = {}): TimedElement =>
  ({ key, window: "w1", frame: { x: 0, y: 0, width: 100, height: 20 }, ...attributes });
export const WINDOW: WindowInfo = { id: "w1", title: "Kitchen Sink", key: true, main: true, frame: { x: 0, y: 0, width: 800, height: 600 } };

type Options = {
  name?: string; kind?: Backend["kind"]; platform?: Platform; matrix?: string[];
  elements?: TimedElement[]; windows?: WindowInfo[]; commands?: Record<string, CommandHandler>; collect?: boolean;
};

export class MemoryBackend implements Backend {
  readonly name: string;
  readonly kind: Backend["kind"];
  readonly platform: Platform;
  readonly matrix: ReadonlySet<string>;
  readonly commands: Record<string, CommandHandler>;
  /** Calls in order: start/stop, handler invocations, restorations. */
  readonly log: string[] = [];
  readonly sessions: Session[] = [];
  items: TimedElement[];
  private readonly windowList: WindowInfo[];
  private readonly collects: boolean;

  constructor(readonly clock: VirtualClock, options: Options = {}) {
    this.name = options.name ?? "memory";
    this.kind = options.kind ?? "black-box";
    this.platform = options.platform ?? "macos";
    this.matrix = new Set(options.matrix ?? []);
    this.items = options.elements ?? [];
    this.windowList = options.windows ?? [WINDOW];
    this.collects = options.collect ?? true;
    this.commands = {
      tapOn: async (_args, context) => { this.log.push(`tapOn ${(await context.target()).element.key}`); await this.clock.sleep(50); },
      setAppearance: async (args, context) => {
        this.log.push(`setAppearance ${args.appearance}`);
        context.onRestore("appearance", async () => { this.log.push("restore appearance"); });
      },
      ...options.commands,
    };
  }

  async start(session: Session) { this.sessions.push(session); this.log.push("start"); }
  async stop() { this.log.push("stop"); }
  async elements() {
    const now = this.clock.now();
    return this.items.filter(item => (item.from ?? 0) <= now && (item.until === undefined || now < item.until)).map(({ from: _from, until: _until, ...rest }) => rest);
  }
  async windows() { return this.windowList; }
  async collect(dir: string): Promise<Artifact[]> {
    if (!this.collects) return [];
    const screenshot = path.join(dir, `${this.name}-screenshot.png`), logs = path.join(dir, `${this.name}.log`);
    writeFileSync(screenshot, "png");
    writeFileSync(logs, this.log.join("\n"));
    return [{ kind: "screenshot", path: screenshot }, { kind: "logs", path: logs }];
  }
}
