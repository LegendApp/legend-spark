import { validateRelease, type ReleaseManifest } from "../packages/cli/src/release.ts";
// @ts-ignore JavaScript build utility shared with the Node launcher.
import { buildCLI } from "./build-node.mjs";
import { spawnProcess } from "../packages/cli/src/process.ts";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { nativePatchRequirements } from "./native-patch-requirements.ts";

/** One published archive; native modules retain private identities for codegen and pruning. */
export async function packSpark(root: string, output: string, release?: ReleaseManifest) {
  buildCLI(root);
  const req = createRequire(path.join(root, "packages/cli/package.json"));
  const npm = path.join(path.dirname(req.resolve("npm/package.json")), "bin/npm-cli.js");
  const temporary = mkdtempSync(path.join(os.tmpdir(), "spark-package-"));
  const stage = path.join(temporary, "spark");
  const archives = path.join(temporary, "archives");
  mkdirSync(archives);
  mkdirSync(output, { recursive: true });
  // AppleDouble root entries break Yarn Classic's strip-one-component extractor.
  async function command(argv: string[], cwd: string) {
    const child = spawnProcess(argv, { cwd, env: { ...process.env, COPYFILE_DISABLE: "1" }, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (code) throw new Error(`${argv[0]} failed: ${stderr}\n${stdout}`);
    return stdout;
  }
  async function pack(directory: string) {
    const result = JSON.parse(await command([process.execPath, npm, "pack", "--json", "--ignore-scripts", "--cache", path.join(temporary, "npm-cache"), "--pack-destination", archives], directory));
    return path.join(archives, result[0].filename);
  }
  async function unpack(archive: string, destination: string) {
    mkdirSync(destination, { recursive: true });
    await command(["tar", "-xzf", archive, "--strip-components=1", "-C", destination], root);
  }
  try {
    const directories = readdirSync(path.join(root, "packages")).filter(name => existsSync(path.join(root, "packages", name, "package.json"))).sort();
    const packages = directories.map(directory => ({ directory, json: JSON.parse(readFileSync(path.join(root, "packages", directory, "package.json"), "utf8")) }));
    const publicPackage = packages.find(pkg => pkg.json.name === "@legendapp/spark")!;
    await unpack(await pack(path.join(root, "packages", publicPackage.directory)), stage);
    const manifest = JSON.parse(readFileSync(path.join(stage, "package.json"), "utf8"));
    manifest.spark = { ...manifest.spark, nativePatchRequirements: nativePatchRequirements(root, manifest.version) };
    const bundled = packages.filter(pkg => pkg !== publicPackage);
    if (bundled.some(pkg => pkg.json.private !== true)) throw new Error("Implementation packages must be private");
    const names = new Set(packages.map(pkg => pkg.json.name));
    const external: Record<string, string> = {};
    const peers: Record<string, string> = {};
    const requiredPeers = new Set<string>();
    for (const pkg of packages) {
      for (const [name, version] of Object.entries(pkg.json.peerDependencies ?? {}) as [string, string][]) {
        if (!names.has(name)) {
          if (peers[name] && peers[name] !== version) throw new Error(`Conflicting peer dependency ${name}`);
          peers[name] = version;
          if (!pkg.json.peerDependenciesMeta?.[name]?.optional) requiredPeers.add(name);
        }
      }
      for (const [name, version] of Object.entries(pkg.json.dependencies ?? {}) as [string, string][]) {
        if (!names.has(name)) {
          if (external[name] && external[name] !== version) throw new Error(`Conflicting dependency ${name}: ${external[name]} / ${version}`);
          external[name] = version;
        }
      }
    }
    for (const name of ["expo", "react", "react-native", "react-dom"]) {
      if (!peers[name]) throw new Error(`Spark package is missing the ${name} peer dependency`);
      if (external[name]) throw new Error(`Singleton package ${name} cannot be both a dependency and a peer dependency`);
    }
    for (const name of ["@react-native-runtimes/core", "react-native-nitro-modules"]) {
      if (!external[name]) throw new Error(`Spark package is missing required native dependency ${name}`);
    }
    for (const pkg of bundled) {
      const destination = path.join(stage, "node_modules", pkg.json.name);
      await unpack(await pack(path.join(root, "packages", pkg.directory)), destination);
    }
    if (release) writeFileSync(path.join(stage, "node_modules/@legendapp/spark-cli/dist/release.json"), JSON.stringify(validateRelease(release), null, 2) + "\n");
    manifest.dependencies = { ...external, ...Object.fromEntries(bundled.map(pkg => [pkg.json.name, pkg.json.version])) };
    manifest.bundledDependencies = bundled.map(pkg => pkg.json.name);
    manifest.peerDependencies = peers;
    manifest.peerDependenciesMeta = Object.fromEntries(Object.keys(peers).filter(name => !requiredPeers.has(name)).map(name => [name, { optional: true }]));
    writeFileSync(path.join(stage, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
    const archive = await pack(stage);
    // npm needs dependency edges to collect private modules. Remove standard
    // bundle metadata afterward: npm publish normalizes it back into registry
    // dependencies, which Yarn tries to fetch. Spark owns native discovery;
    // package managers see only the public SDK and third-party dependencies.
    const final = path.join(temporary, "final");
    const contents = path.join(final, "package");
    await unpack(archive, contents);
    manifest.dependencies = external;
    manifest.spark = { ...manifest.spark, bundledModules: manifest.bundledDependencies, bundledModuleRoot: "vendor" };
    delete manifest.bundledDependencies;
    delete manifest.bundleDependencies;
    // Yarn replaces top-level node_modules during linking. Keep implementation
    // modules under a vendor anchor so their normal sibling resolution survives.
    mkdirSync(path.join(contents, "vendor"));
    renameSync(path.join(contents, "node_modules"), path.join(contents, "vendor/node_modules"));
    for (const file of [...readdirSync(contents).filter(name => /\.(?:[cm]?ts|cjs)$/.test(name)), "bin/spark.cjs"]) {
      const location = path.join(contents, file);
      const source = readFileSync(location, "utf8").replace(/(["'])(@legendapp\/spark-[^"']+)\1/g, (_match, quote, specifier) => {
        const target = path.posix.relative(path.posix.dirname(file), `vendor/node_modules/${specifier}`);
        return `${quote}${target.startsWith(".") ? target : `./${target}`}${quote}`;
      });
      writeFileSync(location, source);
    }
    writeFileSync(path.join(contents, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
    await command(["tar", "-czf", archive, "-C", final, "package"], root);
    const bytes = readFileSync(archive);
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
    const file = `legendapp-spark-${manifest.version}-${hash}.tgz`;
    cpSync(archive, path.join(output, file));
    return file;
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}
