import { VERSION } from "../packages/cli/src/project.ts";
import { spawnProcess, which } from "../packages/cli/src/process.ts";
import { packSpark } from "../scripts/pack-spark.ts";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const framework = path.resolve(import.meta.dirname, "..");
const root = mkdtempSync(path.join(os.tmpdir(), "spark-packed-consumer-"));
async function runNpm(consumer: string, args: string[]) {
  return runManager("npm", consumer, args);
}
async function runManager(manager: string, consumer: string, args: string[]) {
  const child = spawnProcess([manager, ...args], { cwd: consumer, env: { ...process.env, CI: "1" }, stdout: "pipe", stderr: "pipe" });
  const [status, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout!).text(), new Response(child.stderr!).text()]);
  return { status, output: `${stdout}\n${stderr}` };
}
async function managerVersion(manager: string) {
  try { return await runManager(manager, root, ["--version"]); }
  catch (error) { return { status: 127, output: String(error) }; }
}
function managerInstallArgs(manager: string): string[] {
  switch (manager) {
    case "npm": return ["install", "--ignore-scripts", "--no-audit", "--no-fund"];
    case "pnpm": return ["install", "--ignore-scripts", "--no-frozen-lockfile", "--reporter=append-only"];
    case "yarn": return ["install", "--ignore-scripts", "--non-interactive", "--no-progress", "--no-default-rc", "--registry", "https://registry.npmjs.org"];
    case "bun": return ["install", "--ignore-scripts"];
    default: throw new Error(`Unsupported consumer package manager: ${manager}`);
  }
}
async function verifyConsumerSingletons(consumer: string) {
  const require = createRequire(path.join(consumer, "package.json"));
  const pkg = require("@legendapp/spark/package.json");
  const expected = new Map([
    ["react", realpathSync(require.resolve("react/package.json"))],
    ["react-native", realpathSync(require.resolve("react-native/package.json"))],
    ["expo", realpathSync(require.resolve("expo/package.json"))],
  ]);
  const vendor = path.join(consumer, "node_modules/@legendapp/spark/vendor/node_modules");
  for (const name of pkg.spark.bundledModules as string[]) {
    const internal = path.join(vendor, name, "package.json");
    if (!existsSync(internal)) throw new Error(`Packed internal package is missing: ${path.relative(consumer, internal)}`);
    const internalRequire = createRequire(realpathSync(internal));
    const internalManifest = JSON.parse(readFileSync(internal, "utf8"));
    for (const peer of expected.keys()) {
      if (!internalManifest.peerDependencies?.[peer] && !internalManifest.dependencies?.[peer]) continue;
      let resolved: string;
      try { resolved = realpathSync(internalRequire.resolve(`${peer}/package.json`)); }
      catch { throw new Error(`${internalManifest.name} declares ${peer} but could not resolve the consumer installation`); }
      if (resolved !== expected.get(peer)) throw new Error(`${internalManifest.name} resolved a duplicate ${peer}: ${resolved}`);
    }
  }
  return Object.fromEntries(expected);
}
function verifyCliToolchain(consumer: string) {
  const require = createRequire(path.join(consumer, "package.json"));
  const sdk = require("@legendapp/spark/package.json");
  const cliManifestPath = path.join(consumer, "node_modules/@legendapp/spark/vendor/node_modules/@legendapp/spark-cli/package.json");
  const cli = JSON.parse(readFileSync(cliManifestPath, "utf8"));
  if (cli.dependencies.npm !== "11.21.0" || cli.dependencies.ws !== "8.21.0") throw new Error("Packed CLI dependency pins do not include the verified npm and WebSocket fixes");
  const cliRequire = createRequire(realpathSync(cliManifestPath));
  const npmPath = cliRequire.resolve("npm/package.json");
  const npm = JSON.parse(readFileSync(npmPath, "utf8"));
  const tarPath = path.join(path.dirname(npmPath), "node_modules/tar/package.json");
  const tar = JSON.parse(readFileSync(tarPath, "utf8"));
  const wsPath = cliRequire.resolve("ws/package.json");
  const ws = JSON.parse(readFileSync(wsPath, "utf8"));
  if (npm.version !== "11.21.0" || npm.dependencies.tar !== "^7.5.22" || tar.version !== "7.5.22") throw new Error(`Packed CLI resolved npm ${npm.version} with bundled tar ${tar.version}; expected npm 11.21.0 with tar 7.5.22`);
  if (ws.version !== "8.21.0") throw new Error(`Packed CLI resolved ws ${ws.version}; expected 8.21.0`);
  if (sdk.dependencies.npm !== "11.21.0" || sdk.dependencies.ws !== "8.21.0") throw new Error("Packed SDK public dependency manifest does not expose the verified CLI tool versions");
  return { npm: npm.version, tar: tar.version, ws: ws.version };
}
async function verifyCliRuntimes(consumer: string) {
  const cli = path.join(consumer, "node_modules/@legendapp/spark/bin/spark.cjs");
  for (const runtime of ["node", "bun"]) {
    const executable = which(runtime);
    if (!executable) throw new Error(`Install ${runtime} to verify the packed CLI runtime matrix`);
    const child = spawnProcess([executable, cli, "--help"], { cwd: consumer, stdout: "pipe", stderr: "pipe" });
    const [status, out, err] = await Promise.all([child.exited, new Response(child.stdout!).text(), new Response(child.stderr!).text()]);
    if (status !== 0 || !out.includes("--package-manager npm|pnpm|yarn|bun")) throw new Error(`Packed CLI failed on ${runtime}:\n${out}\n${err}`);
  }
}
function manifest(archive: string, react: string) {
  return {
    name: "spark-packed-consumer",
    version: "1.0.0",
    private: true,
    dependencies: {
      "@legendapp/spark": `file:${archive}`,
      expo: "54.0.37",
      react,
      "react-native": "0.81.6",
    },
    devDependencies: { "@types/node": "24.13.6", "@types/react": "19.1.10", typescript: "5.9.3" },
  };
}
try {
  const artifacts = path.join(root, "artifacts"); mkdirSync(artifacts);
  const release = { schema: 1 as const, version: VERSION, revision: "a".repeat(40), packages: {}, runners: {} };
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--archive")) throw new Error("Usage: bun tests/packed-consumer.integration.ts [--archive /path/to/release.tgz]");
  const archive = args.length ? path.resolve(args[1]!) : path.join(artifacts, await packSpark(framework, artifacts, release));
  const archiveName = path.basename(archive);
  const archiveHash = createHash("sha256").update(readFileSync(archive)).digest("hex");
  const consumer = path.join(root, "consumer"); mkdirSync(consumer);
  writeFileSync(path.join(consumer, "package.json"), JSON.stringify(manifest(archive, "19.1.4"), null, 2) + "\n");
  const install = await runNpm(consumer, managerInstallArgs("npm"));
  if (install.status !== 0) throw new Error(`Compatible packed consumer install failed (${install.status}):\n${install.output}`);

  const require = createRequire(path.join(consumer, "package.json"));
  const pkg = require("@legendapp/spark/package.json");
  if (pkg.version !== VERSION || pkg.peerDependencies.react !== "19.1.4" || pkg.peerDependencies["react-native"] !== "0.81.6") throw new Error("Installed packed Spark peer baseline differs from the release manifest");
  if (pkg.peerDependencies["react-dom"] !== "19.1.4" || pkg.peerDependenciesMeta?.["react-dom"]?.optional !== true) throw new Error("React DOM must remain an optional public peer");
  if (pkg.packageManager) throw new Error("The published SDK must not impose the repository package manager on consumers");
  await verifyCliRuntimes(consumer);
  const cliToolchain = verifyCliToolchain(consumer);
  const singletonPaths = await verifyConsumerSingletons(consumer);
  const publicReact = singletonPaths.react!;
  const graph = await runNpm(consumer, ["ls", "react", "react-native", "expo", "--all", "--json"]);
  if (graph.status !== 0) throw new Error(`Installed framework dependency graph is invalid:\n${graph.output}`);
  const graphJson = JSON.parse(graph.output.slice(graph.output.indexOf("{")));
  const versions = new Map<string, Set<string>>();
  const visit = (node: any) => {
    for (const name of ["react", "react-native", "expo"]) {
      const dependency = node.dependencies?.[name];
      if (dependency?.version) (versions.get(name) ?? versions.set(name, new Set()).get(name)!).add(dependency.version);
    }
    for (const dependency of Object.values(node.dependencies ?? {}) as any[]) visit(dependency);
  };
  visit(graphJson);
  for (const name of ["react", "react-native", "expo"]) if (versions.get(name)?.size !== 1) throw new Error(`Installed graph contains multiple or missing ${name} versions: ${[...(versions.get(name) ?? [])].join(", ")}`);

  if (require("@legendapp/spark/config").readConfig === undefined || require("@legendapp/spark/metro").withDesktop === undefined) throw new Error("Installed package entry points did not resolve");
  const types = require("typescript");
  const typeFixture = path.join(consumer, "consumer-types.tsx");
  writeFileSync(typeFixture, readFileSync(path.join(framework, "tests/public-feature-types.types.ts"), "utf8"));
  const program = types.createProgram([typeFixture], {
    strict: true, noEmit: true, skipLibCheck: true, allowImportingTsExtensions: true, target: types.ScriptTarget.ES2022,
    module: types.ModuleKind.ESNext, moduleResolution: types.ModuleResolutionKind.Bundler,
    types: ["node", "react"], jsx: types.JsxEmit.ReactJSX,
  });
  const diagnostics = types.getPreEmitDiagnostics(program).map((diagnostic: any) => types.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
  if (diagnostics.length) throw new Error(`Installed consumer declarations failed to typecheck:\n${diagnostics.join("\n")}`);

  writeFileSync(path.join(consumer, "app.json"), JSON.stringify({ expo: { name: "preflight-fixture", slug: "preflight-fixture", platforms: ["macos"] } }, null, 2) + "\n");
  const before = new Set([".spark", "macos", "windows"].filter(name => existsSync(path.join(consumer, name))));
  const cli = path.join(consumer, "node_modules/.bin/spark");
  const rejected = await spawnProcess([cli, "build", "--dev"], { cwd: consumer, env: { ...process.env, CI: "1" }, stdout: "pipe", stderr: "pipe" });
  const [rejectStatus, rejectOut, rejectErr] = await Promise.all([rejected.exited, new Response(rejected.stdout!).text(), new Response(rejected.stderr!).text()]);
  const rejectOutput = `${rejectOut}\n${rejectErr}`;
  if (rejectStatus === 0 || !/matching patched Spark SDK package|native patch provenance|native patch/i.test(rejectOutput)) throw new Error(`Installed CLI did not reject missing patch receipts with an actionable preflight error:\n${rejectOutput}`);
  const after = new Set([".spark", "macos", "windows"].filter(name => existsSync(path.join(consumer, name))));
  if ([...after].some(name => !before.has(name))) throw new Error(`Native preflight rejection wrote project state: ${[...after].filter(name => !before.has(name)).join(", ")}`);

  const incompatible = path.join(root, "incompatible"); mkdirSync(incompatible);
  writeFileSync(path.join(incompatible, "package.json"), JSON.stringify(manifest(archive, "18.2.0"), null, 2) + "\n");
  const conflict = await runNpm(incompatible, ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"]);
  if (conflict.status === 0 || !/ERESOLVE|unable to resolve dependency tree/i.test(conflict.output)) throw new Error(`Incompatible React baseline was not rejected by npm peer resolution:\n${conflict.output}`);

  const managerResults: Array<{ manager: string; version: string; singletonVerified: boolean }> = [
    { manager: "npm", version: (await managerVersion("npm")).output.trim(), singletonVerified: true },
  ];
  rmSync(consumer, { recursive: true, force: true });
  rmSync(incompatible, { recursive: true, force: true });
  for (const manager of ["pnpm", "yarn", "bun"]) {
    const version = await managerVersion(manager);
    if (version.status !== 0) {
      managerResults.push({ manager: `${manager} (unavailable)`, version: "not installed", singletonVerified: false });
      continue;
    }
    const directory = path.join(root, `${manager}-consumer`); mkdirSync(directory);
    try {
      writeFileSync(path.join(directory, "package.json"), JSON.stringify(manifest(archive, "19.1.4"), null, 2) + "\n");
      console.log(`Installing packed SDK with ${manager}@${version.output.trim()} (lifecycle scripts disabled).`);
      const managerInstall = await runManager(manager, directory, managerInstallArgs(manager));
      if (managerInstall.status !== 0) throw new Error(`${manager}@${version.output.trim()} failed to install the packed SDK graph:\n${managerInstall.output}`);
      const resolved = await verifyConsumerSingletons(directory);
      verifyCliToolchain(directory);
      await verifyCliRuntimes(directory);
      const managerRequire = createRequire(path.join(directory, "package.json"));
      if (managerRequire("@legendapp/spark/config").readConfig === undefined || managerRequire("@legendapp/spark/metro").withDesktop === undefined) throw new Error(`${manager} packed config/Metro exports did not resolve`);
      if (new Set(Object.values(resolved)).size !== 3) throw new Error(`${manager} did not resolve one consumer path each for React, React Native, and Expo`);
      managerResults.push({ manager, version: version.output.trim(), singletonVerified: true });
      console.log(`PASS: ${manager} installed and resolved package exports with one React/RN/Expo path; its temporary consumer will be removed.`);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }

  console.log(`PASS: full ${VERSION} Spark archive ${archiveName} (sha256 ${archiveHash}) installed with ${managerResults.map(result => `${result.manager}@${result.version}${result.singletonVerified ? " (single React/RN/Expo paths)" : " (not tested)"}`).join(", ")}; packed CLI ran on Node and Bun for all installed managers and resolved npm ${cliToolchain.npm} with tar ${cliToolchain.tar} and ws ${cliToolchain.ws}; React DOM remained optional; complete public declarations typechecked with npm; npm rejected React 18.2.0 peer conflict; installed CLI rejected an unpatched native graph before project writes. Lifecycle scripts and native compilation were intentionally skipped.`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
