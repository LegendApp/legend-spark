import { releaseCommand } from "../packages/cli/src/errors.ts";
import { loadReleaseEnv } from "./release-env.ts";
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, rmSync, statfsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { credentials } from "../packages/cli/src/credentials.ts";
import { sparkHome } from "../packages/cli/src/local.ts";
import { spawnProcess } from "../packages/cli/src/process.ts";
import { requireNpmTerminal } from "./npm-release.ts";
import { releaseWorkflow, signingProject, type Execute } from "./release-workflow.ts";

const root = path.resolve(import.meta.dirname, "..");
await releaseCommand(root, async () => {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log("Usage: bun run release [--latest | --next] [--resume | --resume-from publish | --finish]\n\nSelect the next preview version, verify, commit, build/sign/notarize, push and publish.\nEach release moves one npm dist-tag: latest for a stable version, next for a prerelease.\n--latest or --next overrides that channel; --resume retains the original version and channel. Unfinished releases resume automatically.\n--resume-from publish skips build/sign and verifies artifacts/releases/<version>/ before publishing.\n--finish only verifies the published candidate, finishes npm tags and marks it complete. It uses the saved channel and needs no signing credentials.\nRequires Bun, gh/npm login; building requires a clean main checkout on Apple Silicon,\nNode 24.19+, Apple tools and Developer ID / notarization credentials. Native recipient QA remains separate.");
  } else {
    const resumeIndex = args.indexOf("--resume-from");
    const resumeFrom = resumeIndex >= 0 ? args[resumeIndex + 1] : undefined;
    if (resumeIndex >= 0 && resumeFrom !== "publish") throw new Error("Use --resume-from publish to publish existing staged artifacts without build/sign steps.");
    if (args.some((arg, index) => !["--latest", "--next", "--resume", "--finish", "--resume-from"].includes(arg) && !(resumeIndex >= 0 && index === resumeIndex + 1))) throw new Error("Unknown option. Run bun run release --help");
    if (args.includes("--latest") && args.includes("--next")) throw new Error("Choose either --latest or --next. Run bun run release --help");
    if ([args.includes("--resume"), args.includes("--finish"), resumeFrom !== undefined].filter(Boolean).length > 1) throw new Error("Choose --resume, --resume-from publish, or --finish. Run bun run release --help");
    if (!process.versions.bun) throw new Error("Run the release with Bun: bun run release");
    if (!args.includes("--finish") && !resumeFrom && (process.platform !== "darwin" || process.arch !== "arm64")) throw new Error("This automated preview release targets macOS Apple Silicon");
    loadReleaseEnv(root);
    function checkSpace(headroom = 0) {
      const destinations = args.includes("--finish") ? [root] : ["/System/Volumes/Data", root, process.env.TMPDIR ?? "/tmp", path.dirname(sparkHome())];
      for (const destination of destinations) {
        const space = statfsSync(destination);
        const available = space.bavail * space.bsize;
        if (available <= 30_000_000_000 + headroom) throw new Error(`Insufficient disk space on ${destination}: ${(available / 1e9).toFixed(1)} GB available. Preserve the 30 GB reserve; review cleanup before resuming.`);
      }
    }
    mkdirSync(path.join(root, ".spark"), { recursive: true });
    const lock = path.join(root, ".spark/release-workflow.lock");
    if (existsSync(lock)) {
      const pid = Number(readFileSync(lock, "utf8"));
      if (!Number.isInteger(pid) || pid <= 0) throw new Error(`Invalid release lock: ${lock}`);
      try { process.kill(pid, 0); throw new Error(`Release already running (PID ${pid})`); }
      catch (error: any) { if (error.code !== "ESRCH") throw error; rmSync(lock); }
    }
    const fd = openSync(lock, "wx"); writeFileSync(fd, String(process.pid)); closeSync(fd);
    const execute: Execute = async (argv, capture = false) => {
      const heavy = argv[0] === "bun" && (argv[1] === "install" || argv.includes("test") || argv.includes("release:runner")) || argv.includes("tests/packed-consumer.integration.ts");
      if (heavy) checkSpace(10_000_000_000);
      if (argv[0] === "npm" && ["publish", "dist-tag"].includes(argv[1]!)) requireNpmTerminal();
      const child = spawnProcess(argv, { cwd: root, stdin: "inherit", stdout: capture ? "pipe" : "inherit", stderr: capture ? "pipe" : "inherit", detached: true });
      const stop = () => { if (child.pid) { try { process.kill(-child.pid, "SIGTERM"); } catch (error: any) { if (error.code !== "ESRCH") throw error; } } };
      let interrupted = false;
      const interrupt = () => { interrupted = true; stop(); };
      process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
      try {
        const output = capture ? Promise.all([new Response(child.stdout!).text(), new Response(child.stderr!).text()]) : Promise.resolve(["", ""]);
        const [code, [out, err]] = await Promise.all([child.exited, output]);
        if (interrupted) throw new Error("Release interrupted. Preserve its inputs and rerun with --resume.");
        return { code, output: code ? out + err : out };
      } finally { process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt); }
    };
    try {
      process.exitCode = await releaseWorkflow(root, { resume: args.includes("--resume"), latest: args.includes("--latest"), next: args.includes("--next"), finish: args.includes("--finish"), resumeFrom: resumeFrom as "publish" | undefined }, execute, async () => {
        const project = signingProject(root);
        const savedFile = path.join(project, ".spark/signing.json");
        if (existsSync(savedFile)) {
          const saved = JSON.parse(readFileSync(savedFile, "utf8"));
          process.env.SPARK_DEVELOPER_ID_APPLICATION ??= saved.hash;
          process.env.SPARK_NOTARY_KEYCHAIN_PROFILE ??= saved.keychainProfile;
          if (saved.keychain) process.env.SPARK_SIGNING_KEYCHAIN ??= saved.keychain;
        }
        const signing = await credentials(project);
        process.env.SPARK_DEVELOPER_ID_APPLICATION = signing.hash;
        process.env.SPARK_NOTARY_KEYCHAIN_PROFILE = signing.keychainProfile;
        if (signing.keychain) process.env.SPARK_SIGNING_KEYCHAIN = signing.keychain;
      }, version => path.join(sparkHome(), "sdk-builds", version, "SparkRunner"));
    } finally { rmSync(lock, { force: true }); }
  }
});
