// Test doubles for the release harness: a Mac's install and signing tools (FakeMac) and a VM driver (FakeVm).
import { cpSync, existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { VERSION } from "../packages/cli/src/project.ts";
import type { Command, Sh } from "../scripts/harness/install.ts";
import type { Guest, GuestResult, VmDriver } from "../scripts/harness/vm.ts";

export type Signing = "notarized" | "developer-id" | "ad-hoc" | "broken";
const APP = "KitchenSink.app";
const ok = (stdout = "", stderr = ""): Command => ({ code: 0, stdout, stderr });

/** `codesign -dvvv` and `spctl --assess` output as macOS prints them, per kind of signature. */
const DETAILS: Record<Signing, string> = {
  notarized: "CodeDirectory v=20500 size=765 flags=0x10000(runtime) hashes=13+7 location=embedded\nSignature size=8989\nAuthority=Developer ID Application: Example Corp (ABCDE12345)\nAuthority=Developer ID Certification Authority\nAuthority=Apple Root CA\nTimestamp=Oct 1, 2026 at 5:25:13 AM\nTeamIdentifier=ABCDE12345\n",
  "developer-id": "CodeDirectory v=20500 size=765 flags=0x0(none) hashes=13+7 location=embedded\nSignature size=8989\nAuthority=Developer ID Application: Example Corp (ABCDE12345)\nAuthority=Developer ID Certification Authority\nAuthority=Apple Root CA\nTeamIdentifier=ABCDE12345\n",
  "ad-hoc": "CodeDirectory v=20400 size=14525 flags=0x2(adhoc) hashes=447+3 location=embedded\nSignature=adhoc\nTeamIdentifier=not set\n",
  broken: "CodeDirectory v=20400 size=14525 flags=0x2(adhoc) hashes=447+3 location=embedded\nSignature=adhoc\nTeamIdentifier=not set\n",
};

/**
 * hdiutil, ditto, xattr, codesign, spctl, stapler and git archive over real temporary files. A quarantined disk image or
 * archive passes its quarantine to what is copied out of it, as macOS does, unless `propagate` is false. The app inside
 * records `revision` as its source revision (spark-runtime.json), or none when it is undefined. The first `busyDetaches`
 * `hdiutil detach` calls fail as a busy volume does.
 */
export class FakeMac {
  readonly calls: string[][] = [];
  private readonly attributes = new Map<string, string>();
  private readonly quarantinedVolumes = new Set<string>();
  busyDetaches = 0;
  constructor(public signing: Signing = "notarized", private readonly propagate = true, public revision: string | undefined = undefined, public stapled = true) {}

  private app(at: string) {
    mkdirSync(path.join(at, "Contents/MacOS"), { recursive: true });
    mkdirSync(path.join(at, "Contents/Resources"), { recursive: true });
    writeFileSync(path.join(at, "Contents/Info.plist"), "<plist/>");
    const runtime = { schema: 1, framework: VERSION, platform: "macos", arch: "arm64", mode: "release", fingerprint: "fixture", modules: {}, ...(this.revision ? { sourceRevision: this.revision } : {}) };
    writeFileSync(path.join(at, "Contents/Resources/spark-runtime.json"), JSON.stringify(runtime));
  }
  private quarantined(file: string) {
    return this.attributes.has(file) || [...this.quarantinedVolumes].some(volume => file.startsWith(`${volume}/`));
  }
  private inherit(from: string, to: string) {
    if (this.propagate && this.quarantined(from)) this.attributes.set(to, "0081;00000000;;");
  }

  readonly sh: Sh = async argv => this.command(argv);

  /** Commands (by name) that fail with the given result instead. */
  readonly failures = new Map<string, Command>();

  private command(argv: string[]): Command {
    this.calls.push(argv);
    const failure = this.failures.get(argv[0]!);
    if (failure) return failure;
    const [command, ...args] = argv;
    if (command === "xattr" && args[0] === "-w") { this.attributes.set(args[3]!, args[2]!); return ok(); }
    if (command === "xattr" && args[0] === "-d" && args[1] === "-r") { this.attributes.delete(args[3]!); return ok(); }
    if (command === "xattr" && args[0] === "-p") {
      const value = this.attributes.get(args[2]!);
      return value ? ok(`${value}\n`) : { code: 1, stdout: "", stderr: `xattr: ${args[2]}: No such xattr: ${args[1]}` };
    }
    if (command === "hdiutil" && args[0] === "create") { writeFileSync(args[args.indexOf("-o") + 1]!, "disk image"); return ok(); }
    if (command === "hdiutil" && args[0] === "attach") {
      const volume = args[args.indexOf("-mountpoint") + 1]!;
      this.app(path.join(volume, APP));
      symlinkSync("/Applications", path.join(volume, "Applications"));
      if (this.attributes.has(args[1]!)) this.quarantinedVolumes.add(volume);
      return ok();
    }
    if (command === "hdiutil" && args[0] === "detach") {
      if (this.busyDetaches-- > 0) return { code: 16, stdout: "", stderr: `hdiutil: couldn't unmount "disk4" - Resource busy` };
      return ok();
    }
    if (command === "ditto" && args[0] === "-x") {
      this.app(path.join(args[3]!, APP));
      this.inherit(args[2]!, path.join(args[3]!, APP));
      return ok();
    }
    if (command === "ditto") { cpSync(args[0]!, args[1]!, { recursive: true }); this.inherit(args[0]!, args[1]!); return ok(); }
    if (command === "codesign" && args[0] === "--verify") {
      return this.signing === "broken" ? { code: 1, stdout: "", stderr: `${args.at(-1)}: a sealed resource is missing or invalid` } : ok("", `${args.at(-1)}: valid on disk\n${args.at(-1)}: satisfies its Designated Requirement`);
    }
    if (command === "codesign" && args[0] === "-dvvv") return ok("", `Executable=${args[1]}/Contents/MacOS/KitchenSink\nIdentifier=so.legend.kitchensink\n${DETAILS[this.signing]}`);
    if (command === "spctl") {
      const app = args.at(-1);
      if (this.signing === "notarized") return ok("", `${app}: accepted\nsource=Notarized Developer ID\n`);
      return { code: 3, stdout: "", stderr: this.signing === "developer-id" ? `${app}: rejected\nsource=Unnotarized Developer ID\n` : `${app}: rejected\n` };
    }
    if (command === "xcrun" && args[0] === "stapler") {
      return this.signing === "notarized" && this.stapled ? ok(`Processing: ${args[2]}\nThe validate action worked!\n`) : { code: 65, stdout: `Processing: ${args[2]}\n${args[2]} does not have a ticket stapled to it.\n`, stderr: "" };
    }
    if (command === "git" && args[2] === "archive") { writeFileSync(args[args.indexOf("-o") + 1]!, `source of ${args.at(-1)}`); return ok(); }
    throw new Error(`FakeMac: unexpected command ${argv.join(" ")}`);
  }
}

/** A VM driver whose guest is a function of the shared directory (as the host sees it) and the command. */
export class FakeVm implements VmDriver {
  readonly name = "fake";
  readonly events: string[] = [];

  constructor(private readonly guest: (share: string, argv: string[], signal?: AbortSignal) => Promise<GuestResult>) {}

  async boot(image: string, share: string, signal?: AbortSignal): Promise<Guest> {
    if (!existsSync(share)) throw new Error(`FakeVm: the share ${share} does not exist`);
    signal?.throwIfAborted();
    this.events.push(`boot ${image}`);
    return {
      share: "/Volumes/Guest Share",
      exec: async (argv, execSignal) => { this.events.push("exec"); return this.guest(share, argv, execSignal); },
      dispose: async () => { this.events.push("dispose"); },
    };
  }
}

/** The harness arguments in a guest script's `bun scripts/harness/cli.ts …` line. */
export function guestArgs(script: string): string[] {
  const line = script.split("\n").find(candidate => candidate.startsWith("bun scripts/harness/cli.ts "))!;
  return [...line.matchAll(/'((?:[^']|'\\'')*)'/g)].map(match => match[1]!.replaceAll(`'\\''`, "'"));
}
