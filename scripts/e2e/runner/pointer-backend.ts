import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { Failure, type Backend, type CommandHandler, type Session } from "./backend.ts";
import type { DriverBackend } from "./driver-backend.ts";

const execute = promisify(execFile);

/** OS mouse input with in-process testID lookup. Requires Accessibility input-posting access. */
export class PointerBackend implements Backend {
  readonly name = "pointer";
  readonly kind = "black-box";
  readonly platform = "macos";
  readonly matrix: ReadonlySet<string> = new Set();
  readonly queryKeys: ReadonlySet<"id"> = new Set(["id"]);
  private helper = "";
  readonly commands: Readonly<Record<string, CommandHandler>> = {
    tapOn: async (args, context) => {
      if ((args.modifiers as string[] | undefined)?.length) throw new Failure("unsupported", "pointer tapOn does not support modifiers");
      const target = await context.target();
      await this.post(["check"]);
      const { pid, down, up } = await this.driver.pointerEvents(`id:${target.element.window}`, target.point);
      await this.post([String(pid), down, up]);
    },
  };

  constructor(private readonly driver: DriverBackend) {}

  async start(session: Session) {
    if (process.platform !== "darwin") throw new Failure("unsupported", "pointer input is available on macOS only");
    this.helper = path.join(session.dir, "macos-pointer");
    await execute("clang", ["-fobjc-arc", "-framework", "AppKit", "-framework", "ApplicationServices",
      path.resolve(import.meta.dirname, "../macos-pointer.m"), "-o", this.helper], { timeout: 60000 });
  }
  async stop() {}
  query: DriverBackend["query"] = (atom, scope) => this.driver.query(atom, scope);

  private async post(args: string[]) {
    try { await execute(this.helper, args, { timeout: 10000 }); }
    catch (error) {
      const failure = error as Error & { stderr?: string };
      throw new Failure("error", failure.stderr?.trim() || failure.message);
    }
  }
}
