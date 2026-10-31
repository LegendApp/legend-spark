import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { DriverError } from "../driver.ts";
import { Failure, type Backend, type CommandHandler, type Session } from "./backend.ts";
import type { DriverBackend } from "./driver-backend.ts";

const execute = promisify(execFile);
/** The longest single settle wait, well under the driver's reply limit. */
const SETTLE_SLICE_MS = 5000;

/** OS mouse input with in-process testID lookup. Requires Accessibility input-posting access. */
export class PointerBackend implements Backend {
  readonly name = "pointer";
  readonly kind = "black-box";
  readonly platform = "macos";
  readonly matrix: ReadonlySet<string> = new Set();
  readonly queryKeys: ReadonlySet<"id"> = new Set(["id"]);
  private helper?: Promise<string>;
  readonly commands: Readonly<Record<string, CommandHandler>> = {
    tapOn: async (args, context) => {
      if ((args.modifiers as string[] | undefined)?.length) throw new Failure("unsupported", "pointer tapOn does not support modifiers");
      // Gesture recognizers attach after their views mount, so a tap waits for mounts to settle. A screen that keeps
      // mounting (a spinner) is waited on in slices that re-resolve the target, then tapped once the timeout is spent.
      // Every wait shares the step's timeout.
      const until = Date.now() + context.timeoutMs;
      for (;;) {
        const target = await context.target(Math.max(0, until - Date.now())), settleMs = Math.max(0, Math.min(until - Date.now(), SETTLE_SLICE_MS));
        try {
          const { pid, down, up } = await this.driver.pointerEvents(`id:${target.element.window}`, target.point, settleMs);
          return await this.post([String(pid), down, up]);
        } catch (error) {
          if (!(error instanceof DriverError && error.code === "E_NOT_SETTLED")) throw error;
        }
      }
    },
  };

  constructor(private readonly driver: DriverBackend) {}

  async start(session: Session) {
    if (process.platform !== "darwin") throw new Failure("unsupported", "pointer input is available on macOS only");
    if (!this.helper) {
      const helper = path.join(session.dir, "macos-pointer");
      this.helper = execute("clang", ["-fobjc-arc", "-framework", "Foundation", "-framework", "ApplicationServices",
        path.resolve(import.meta.dirname, "../macos-pointer.m"), "-o", helper], { timeout: 60000 }).then(() => helper);
    }
    await this.post(["check"]);
  }
  async stop() { await this.driver.restorePointer(); }
  query: DriverBackend["query"] = (atom, scope) => this.driver.query(atom, scope);

  private async post(args: string[]) {
    try { await execute((await this.helper)!, args, { timeout: 10000 }); }
    catch (error) {
      const failure = error as Error & { stderr?: string };
      throw new Failure("error", failure.stderr?.trim() || failure.message);
    }
  }
}
