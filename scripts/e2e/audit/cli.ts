// The gate's cli audit: the `spark` command line as an app gets it (packages/desktop/bin/spark.cjs, the SDK's bin),
// its help and its errors (docs/e2e-flows.md#audits, #171). Every case runs headless (no TTY, CI=1) with a scratch
// SPARK_HOME, and only cases that fail before any side effect, so nothing is created, built or registered.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { commands } from "../../../packages/cli/src/cli-arguments.ts";
import { KITCHEN_SINK } from "../kitchen-sink.ts";
import type { AuditResult } from "./bundle.ts";

const repo = path.resolve(import.meta.dirname, "../../..");
const bin = path.join(repo, "packages/desktop/bin/spark.cjs");
const version = JSON.parse(readFileSync(path.join(repo, "packages/desktop/package.json"), "utf8")).version as string;

/** Each error case: the arguments and what its one-line message must name. */
const ERRORS: Array<[string[], string]> = [
  [["bogus"], "Unknown command: bogus"],
  [["build", "--bogus"], "--bogus"],
  [["create"], "spark create"],
  [["build", "extra"], "spark build"],
  [["sdk"], "spark sdk export"],
  [["build", "--platform", "beos"], "Platform must be"],
  [["build", "--port", "99999"], "Port must be"],
  [["create", "App", "--package-manager", "zz"], "Package manager must be"],
  [["create", "App", "--example", "nope"], "--example"],
  [["build", "--dev", "--release"], "build mode"],
  [["build"], "No spark app found"],
  [["dev"], "No spark app found"],
];

export function auditCli(): AuditResult[] {
  const scratch = mkdtempSync(path.join(os.tmpdir(), "spark-cli-audit-"));
  try {
    const spark = (args: string[], cwd = scratch) => {
      const result = spawnSync("node", [bin, ...args], { cwd, encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, CI: "1", SPARK_HOME: path.join(scratch, ".spark") } });
      return { status: result.status, stdout: result.stdout, stderr: result.stderr, label: `spark ${args.join(" ")}`.trim() };
    };
    const help: string[] = [], errors: string[] = [];
    const global = spark(["--help"]);
    const names = ["dev", ...Object.keys(commands)];
    const missing = names.filter(name => !new RegExp(`(^|[\\s/])${name}\\b`, "m").test(global.stdout));
    if (global.status !== 0 || missing.length) help.push(`spark --help exited ${global.status} and does not name ${missing.join(", ") || "-"}`);
    for (const args of [[], ["-h"], ...names.map(name => [...name.split(" "), "--help"])]) {
      const run = spark(args);
      if (run.status !== 0 || !run.stdout.includes("spark ") || run.stderr.trim()) help.push(`${run.label} exited ${run.status}${run.stderr.trim() ? ` with ${JSON.stringify(run.stderr.trim().split("\n")[0])}` : ""}`);
    }
    const devHelp = spark(["dev", "--help"], KITCHEN_SINK);
    if (devHelp.status !== 0 || !devHelp.stdout.includes("--no-open") || !devHelp.stdout.includes("--port")) help.push(`spark dev --help in an app exited ${devHelp.status} without spark's and expo start's options`);
    const printed = spark(["--version"]);
    if (printed.status !== 0 || printed.stdout.trim() !== version) help.push(`spark --version exited ${printed.status} and printed ${JSON.stringify(printed.stdout.trim())}, not ${version}`);
    for (const [args, names] of ERRORS) {
      const run = spark(args), lines = run.stderr.trim().split("\n");
      if (run.status !== 1 || run.stdout.trim() || lines.length !== 1 || !lines[0]!.includes(names))
        errors.push(`${run.label}: exit ${run.status}, stdout ${JSON.stringify(run.stdout.trim().slice(0, 80))}, stderr ${JSON.stringify(run.stderr.trim().slice(0, 300))}; expected exit 1 and one line naming ${JSON.stringify(names)}`);
    }
    return [
      { check: "DX-CLI-01", status: help.length ? "failed" : "passed", details: help.length ? help : [`spark --help names all ${names.length} commands; -h, no arguments and each command's --help exit 0; spark dev --help in an app adds expo start's options; spark --version prints ${version}`] },
      { check: "DX-CLI-02", status: errors.length ? "failed" : "passed", details: errors.length ? errors : [`${ERRORS.length} misuses (unknown command and option, missing and extra arguments, a group without its subcommand, invalid values, conflicting modes, no app) exit 1 with one line on stderr that names the problem, no stack trace`] },
    ];
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}
