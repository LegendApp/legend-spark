import { existsSync, mkdirSync, openSync, closeSync, readFileSync, rmSync, statfsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { credentials } from "../packages/cli/src/credentials.ts";
import { sparkHome } from "../packages/cli/src/local.ts";
import { spawnProcess } from "../packages/cli/src/process.ts";
import { releaseWorkflow, signingProject, type Execute } from "./release-workflow.ts";

const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log("Usage: npm run release -- [--latest] [--resume]\n\nSelect the next preview version, verify, commit, build/sign/notarize, push and publish.\n--latest also assigns npm latest; --resume retains the original version and channels.\nRequires a clean main checkout on Apple Silicon, Node 24.19+, Apple tools, gh/npm login\nand Developer ID / notarization credentials. Native recipient QA remains separate.");
} else {
  if (args.some(arg => !["--latest", "--resume"].includes(arg))) throw new Error("Unknown option. Run npm run release -- --help");
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major! < 24 || (major === 24 && minor! < 19)) throw new Error("Release requires Node 24.19.0 or newer; use the version in .nvmrc");
  if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("This automated preview release targets macOS Apple Silicon");
  const root = path.resolve(import.meta.dirname, "..");
  if (existsSync(path.join(root, ".env"))) process.loadEnvFile(path.join(root, ".env"));
  function checkSpace(headroom = 0) {
    const destinations = ["/System/Volumes/Data", root, process.env.TMPDIR ?? "/tmp", path.dirname(sparkHome())];
    for (const destination of destinations) {
      const space = statfsSync(destination);
      const available = space.bavail * space.bsize;
      if (available <= 50_000_000_000 + headroom) throw new Error(`Insufficient disk space on ${destination}: ${(available / 1e9).toFixed(1)} GB available. Preserve the 50 GB reserve; review cleanup before resuming.`);
    }
  }
  checkSpace();
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
    const heavy = argv[0] === "npm" && (argv[1] === "ci" || argv[1] === "test" || argv.includes("release:runner")) || argv.includes("tests/packed-consumer.integration.ts");
    checkSpace(heavy ? 10_000_000_000 : 0);
    const child = spawnProcess(argv, { cwd: root, stdin: "inherit", stdout: capture ? "pipe" : "inherit", stderr: capture ? "pipe" : "inherit", detached: true });
    const stop = () => { if (child.pid) { try { process.kill(-child.pid, "SIGTERM"); } catch (error: any) { if (error.code !== "ESRCH") throw error; } } };
    let diskError: unknown;
    let interrupted = false;
    const monitor = setInterval(() => { try { checkSpace(); } catch (error) { diskError = error; stop(); } }, 30_000);
    const interrupt = () => { interrupted = true; stop(); };
    process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
    try {
      const output = capture ? Promise.all([new Response(child.stdout!).text(), new Response(child.stderr!).text()]) : Promise.resolve(["", ""]);
      const [code, [out, err]] = await Promise.all([child.exited, output]);
      if (diskError) throw diskError;
      if (interrupted) throw new Error("Release interrupted. Preserve its inputs and rerun with --resume.");
      checkSpace();
      return { code, output: code ? out + err : out };
    } finally { clearInterval(monitor); process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt); }
  };
  try {
    process.exitCode = await releaseWorkflow(root, { resume: args.includes("--resume"), latest: args.includes("--latest") }, execute, async () => {
      const signing = await credentials(signingProject(root));
      process.env.SPARK_DEVELOPER_ID_APPLICATION = signing.hash;
      process.env.SPARK_NOTARY_KEYCHAIN_PROFILE = signing.keychainProfile;
      if (signing.keychain) process.env.SPARK_SIGNING_KEYCHAIN = signing.keychain;
    }, version => path.join(sparkHome(), "sdk-builds", version, "SparkRunner"));
  } finally { rmSync(lock, { force: true }); }
}
