import { restoreNativeMetadata } from "./native-metadata.ts";
import { assertNativePatchPreflight } from "./native-patch-preflight.ts";
import { missingNativeFrameworks, preparationChanges, preserveMacOSPods, type NativePreparation } from "./native-preparation.ts";
import { macOSReleaseSettings } from "./macos-release.ts";
import { macOSXcodeArchitecture, projectPlatform } from "./platform.ts";
import { isUniversal, isExpoProject } from "@legendapp/spark-desktop-config/config.cjs";
import { buildWindows } from "./windows.ts";
import { copyHelpers } from "./helpers.ts";
import { readAppConfig } from "./project.ts";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  writeFileSync,
  openSync,
  closeSync,
} from "node:fs";
import path from "node:path";
import { registerRuntime } from "./local.ts";
import { binary, doctor, run } from "./commands.ts";
import {
  prepareConfig,
  entryFile,
  digest,
  hashFiles,
  nativePreparationInputs,
  nativeProjectFingerprint,
  localSigningIdentity,
  nativePackages,
  readJson,
  runtimeFor,
  selection,
  stateFile,
  writeJson,
  validateBuildModules,
  goConfigurationIssues,
  type NativePackage,
  type Runtime,
} from "./project.ts";

export async function analyze(root: string, packages = nativePackages(root)) {
  assertNativePatchPreflight(root);
  if (projectPlatform(root) === "windows") throw new Error("Windows production analysis is not implemented; use spark build --dev.");
  prepareConfig(root);
  const dir = stateFile(root, "analysis");
  mkdirSync(dir, { recursive: true });
  const exportBundle = async (env: Record<string, string>) => run(
    root,
    [
      binary(root, "expo"),
      "export:embed",
      "--platform",
      "macos",
      "--entry-file",
      // Metro resolves export entries from its server root, which can be the
      // containing workspace rather than this app's project root.
      path.resolve(root, entryFile(root)),
      "--bundle-output",
      path.join(dir, "app.js"),
      "--sourcemap-output",
      path.join(dir, "app.map"),
      "--dev",
      "false",
      "--minify",
      "false",
      "--max-workers",
      "2",
    ],
    { env: { CI: "1", ...env }, label: "Analyzing production JavaScript" },
  );
  await exportBundle({ SPARK_RUNTIME_DISCOVERY: "1" });
  const discovery = readJson(path.join(dir, "app.map"));
  const runtimeCore = packages.find(pkg => pkg.name === "@react-native-runtimes/core");
  const roots = (discovery.sources as string[]).filter(source => !source.includes("\0")).map(source => {
    const absolute = path.resolve(root, source);
    // Expo emits URL-like /node_modules and /App.tsx paths as well as absolute paths.
    return existsSync(absolute) ? absolute : path.resolve(root, source.replace(/^\//, ""));
  }).filter(source => existsSync(source)).map(source => realpathSync(source));
  const enabled = !!runtimeCore && (discovery.sources as string[]).some(source => (source.startsWith(runtimeCore.root + "/") || source.includes("/node_modules/@react-native-runtimes/core/")) && !source.endsWith("secondary-runtime-polyfill.js"));
  if (enabled && !(discovery.sources as string[]).some(source => ["/@legendapp/spark-cli/src/runtime-entry.cjs", "/@legendapp/spark-cli/dist/runtime-entry.cjs"].some(entry => source.endsWith(entry)))) {
    throw new Error("Runtimes requires withDesktop in metro.config.js and the worker-aware index.ts. See docs/runtimes.md migration instructions.");
  }
  const runtimeSources = path.join(dir, "runtime-sources.json");
  writeJson(runtimeSources, { enabled, roots: roots.filter(source =>
    /\.[jt]sx?$/.test(source) && !source.endsWith(".d.ts") &&
    !source.includes("/node_modules/@react-native-runtimes/core/") &&
    (!source.includes("/node_modules/") || /["']@react-native-runtimes\/core["']/.test(readFileSync(source, "utf8")))
  ) });
  await exportBundle({ SPARK_RUNTIME_SOURCES: runtimeSources });
  const map = readJson(path.join(dir, "app.map"));
  const used = new Set<string>();
  for (const source of map.sources as string[]) {
    for (const pkg of packages) {
      // Metro's source map can contain absolute paths or project-relative node_modules paths.
      if (
        source.startsWith(pkg.root + "/") ||
        source.includes(`/node_modules/${pkg.name}/`) ||
        source.startsWith(`node_modules/${pkg.name}/`)
      )
        used.add(pkg.name);
    }
  }
  const config = readAppConfig(root);
  const result = selection(
    packages,
    used,
    config.expo?.extra?.spark?.include ?? [],
  );
  writeJson(stateFile(root, "selection-report.json"), {
    included: result.included.map((p) => p.name),
    excluded: result.excluded.map((p) => p.name),
    reasons: result.reasons,
    sources: map.sources,
  });
  return result;
}

export async function build(
  root: string,
  mode: "go" | "dev" | "preview" | "release",
  force = false,
): Promise<{ app: string; runtime: Runtime }> {
  assertNativePatchPreflight(root);
  const lock = stateFile(root, "build.lock");
  mkdirSync(path.dirname(lock), { recursive: true });
  try {
    const fd = openSync(lock, "wx");
    writeFileSync(fd, String(process.pid));
    closeSync(fd);
  } catch (error: any) {
    if (error.code !== "EEXIST") throw error;
    const pid = Number(readFileSync(lock, "utf8"));
    if (!Number.isInteger(pid) || pid <= 0)
      throw new Error(
        `Invalid build lock: ${lock}. Check for an active build before removing it.`,
      );
    try {
      process.kill(pid, 0);
    } catch (signalError: any) {
      if (signalError.code === "ESRCH") {
        rmSync(lock);
        return build(root, mode, force);
      }
    }
    throw new Error(
      `Another build owns this project (PID ${pid}). Wait for it to finish.`,
    );
  }
  try {
    const result = await buildUnlocked(root, mode, force);
    if (mode === "go") {
      registerRuntime(result.app);
      console.log("Spark Runner registered. Apps will discover it automatically.");
    }
    return result;
  } finally {
    rmSync(lock, { force: true });
  }
}

async function buildUnlocked(
  root: string,
  mode: "go" | "dev" | "preview" | "release",
  force: boolean,
): Promise<{ app: string; runtime: Runtime }> {
  if (projectPlatform(root) === "windows") return buildWindows(root, mode, force);
  prepareConfig(root);
  if (mode === "go") {
    const issues = goConfigurationIssues(readAppConfig(root));
    if (issues.length) throw new Error(`Build the Spark Runner from a generic SDK starter: ${issues.join("; ")}`);
  }
  await doctor(root);
  const all = nativePackages(root);
  const productionGraph = mode === "release" || mode === "preview";
  const chosen = productionGraph
    ? await analyze(root, all)
    : { included: all, excluded: [] as NativePackage[] };
  validateBuildModules(mode, chosen.included);
  const runtime = runtimeFor(root, chosen.included, mode);
  const productionHash = productionGraph
    ? hashFiles(root, [path.relative(root, stateFile(root, "analysis/app.js"))])
    : undefined;
  if (productionHash)
    runtime.fingerprint = digest(runtime.fingerprint + productionHash);
  const resultFile = stateFile(root, `${mode}-build.json`);
  const excludedNames = [...new Set<string>([
    ...(readAppConfig(root).expo.autolinking?.exclude ?? []),
    ...chosen.excluded.map((p) => p.name),
  ])];
  writeJson(stateFile(root, "native-selection.json"), {
    excluded: excludedNames,
    included: chosen.included.map((p) => ({ name: p.name, root: p.root })),
  });
  const rnConfig = path.join(root, "react-native.config.js");
  const marker = "// Generated by spark; extend with configuration plugins.";
  if (
    existsSync(rnConfig) &&
    !readFileSync(rnConfig, "utf8").startsWith(marker) &&
    !(isExpoProject(root) && readFileSync(rnConfig, "utf8").includes("// spark: existing Expo project"))
  )
    throw new Error(
      "Existing react-native.config.js is not spark-managed. Compose the native selection explicitly before building.",
    );
  if (!isUniversal(root)) writeFileSync(
    rnConfig,
    `${marker}\nconst selection = require('./.spark/native-selection.json');\nmodule.exports = { dependencies: Object.fromEntries([\n...selection.included.map(p => [p.name, { root: p.root }]),\n...selection.excluded.map(name => [name, { platforms: { ios: null, macos: null, android: null } }])\n]) };\n`,
  );
  const pkg = readJson(path.join(root, "package.json"));
  if (!isUniversal(root)) {
    pkg.expo ??= {};
    pkg.expo.autolinking ??= {};
    pkg.expo.autolinking.exclude = excludedNames;
    writeJson(path.join(root, "package.json"), pkg);
  }
  const inputs = nativePreparationInputs(root, chosen.included);
  const preparation = { fingerprint: digest(JSON.stringify(inputs)), inputs, projectFingerprint: nativeProjectFingerprint(inputs, chosen.included) };
  const preparedFile = stateFile(root, "native-preparation.json");
  const prepared: NativePreparation | undefined = existsSync(preparedFile) ? readJson(preparedFile) : undefined;
  const nativeRoot = path.join(root, "macos");
  const hasNativeProject = existsSync(nativeRoot) && readdirSync(nativeRoot).some(name =>
    name.endsWith(".xcodeproj") && existsSync(path.join(nativeRoot, name, "project.pbxproj")));
  const needsProject = force || !hasNativeProject || prepared?.projectFingerprint !== preparation.projectFingerprint;
  const needsPreparation =
    needsProject ||
    prepared?.fingerprint !== preparation.fingerprint ||
    !existsSync(path.join(root, "macos/Pods/Manifest.lock"));
  const existing = existsSync(resultFile) ? readJson(resultFile) : undefined;
  if (!force && existing) {
    if (
      existing.runtime.fingerprint === runtime.fingerprint &&
      existing.preparation?.fingerprint === preparation.fingerprint &&
      existsSync(existing.app)
    ) {
      console.log(`Reusing ${existing.app}`);
      return existing;
    }
  }
  const reasons = force ? ["forced build"] : !existing ? ["no cached app"] : [
    ...preparationChanges(existing.preparation, preparation),
    ...(existing.runtime.fingerprint !== runtime.fingerprint ? ["runtime inputs changed"] : []),
    ...(!existsSync(existing.app) ? ["cached app missing"] : []),
  ];
  console.log(`Building ${mode} runtime: ${reasons.join("; ")}.`);
  const nativeConfig = readAppConfig(root).expo;
  if (needsPreparation) rmSync(preparedFile, { force: true });
  if (needsProject) {
    console.log(`Preparing native project (preserving CocoaPods cache): ${force ? "forced build" : !hasNativeProject ? "native project missing" : preparationChanges(prepared, preparation).join("; ") || "native project provenance missing"}.`);
    const manifest = readFileSync(path.join(root, "package.json"), "utf8");
    const appJson = path.join(root, "app.json");
    const originalAppJson = existsSync(appJson) ? readFileSync(appJson, "utf8") : undefined;
    try {
      await preserveMacOSPods(root, () => run(
        root,
        [
          binary(root, "expo-desktop"),
          "prebuild",
          "--platform",
          "macos",
          "--template",
          "expo-desktop-template-bare-minimum@54.81.1",
          "--no-install",
          // Template renaming is not idempotent (HelloWorld becomes
          // LegendHelloWorld, then LegendLegendHelloWorld). Native projects
          // are generated output; recreate them only when project inputs change.
          "--clean",
        ],
        { env: { CI: "1" }, label: "Generating native project" },
      ));
      // Expo Desktop copies all-platform template dependencies even for macOS. Preserve this
      // platform's installed manifest instead of silently adding uninstalled Windows packages.
    } finally {
      writeFileSync(path.join(root, "package.json"), manifest);
      // Upstream template replacement also rewrites app.json substrings.
      if (originalAppJson !== undefined) writeFileSync(appJson, originalAppJson);
    }
  }
  if (needsPreparation) {
    // ReactCodegen's source glob must not pick up bindings from a previously larger graph.
    rmSync(path.join(root, "macos/build/generated"), {
      recursive: true,
      force: true,
    });
  }
  const missing = missingNativeFrameworks(root);
  if (needsPreparation || missing.length) {
    if (needsPreparation && !needsProject) console.log(`Updating CocoaPods dependencies: ${prepared?.fingerprint !== preparation.fingerprint ? preparationChanges(prepared, preparation).join("; ") : "CocoaPods state missing"}.`);
    if (missing.length && !needsPreparation) console.log(`Restoring missing native frameworks:\n${missing.join("\n")}`);
    await run(root, ["pod", "install"], {
      cwd: path.join(root, "macos"),
      env: { RCT_NEW_ARCH_ENABLED: "1" },
      label: "Installing CocoaPods dependencies",
    });
    const remaining = missingNativeFrameworks(root);
    if (remaining.length) throw new Error(`Native frameworks are missing after pod install. Restore the package's native artifacts and retry:\n${remaining.join("\n")}`);
    writeJson(preparedFile, preparation);
  }
  await restoreNativeMetadata(root, nativeConfig);
  const workspace = readdirSync(nativeRoot).find((name) =>
    name.endsWith(".xcworkspace"),
  );
  if (!workspace)
    throw new Error("Prebuild did not produce a macOS workspace.");
  const name = workspace.slice(0, -".xcworkspace".length);
  const configuration = mode === "release" ? "Release" : "Debug";
  const xcodeArch = macOSXcodeArchitecture(runtime.arch);
  const derived = stateFile(root, `DerivedData/macos-${runtime.arch}`);
  await run(
    root,
    [
      "xcodebuild",
      "-workspace",
      path.join(nativeRoot, workspace),
      "-scheme",
      `${name}-macOS`,
      "-configuration",
      configuration,
      "-destination",
      `platform=macOS,arch=${xcodeArch}`,
      "-derivedDataPath",
      derived,
      `ARCHS=${xcodeArch}`,
      "ONLY_ACTIVE_ARCH=YES",
      "CODE_SIGNING_ALLOWED=NO",
      ...(mode === "release" ? macOSReleaseSettings : []),
      "-jobs",
      "8",
      "build",
    ],
    {
      env: { RCT_NEW_ARCH_ENABLED: "1", ENTRY_FILE: entryFile(root), ...(productionGraph ? { SPARK_RUNTIME_SOURCES: stateFile(root, "analysis/runtime-sources.json") } : {}) },
      label: `Building ${mode === "go" ? "Spark Runner" : mode} runtime (${configuration}, ${runtime.arch})`,
    },
  );
  const products = path.join(derived, "Build", "Products", configuration);
  const product = readdirSync(products).find((name) => name.endsWith(".app"));
  if (!product) throw new Error("Build completed without an app product.");
  const destination = stateFile(root, `products/macos-${runtime.arch}/${mode}/${product}`);
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(path.dirname(destination), { recursive: true });
  cpSync(path.join(products, product), destination, { recursive: true, verbatimSymlinks: true });
  if (
    mode === "release" &&
    !existsSync(path.join(destination, "Contents/Resources/main.jsbundle"))
  )
    throw new Error("Standalone build is missing its JavaScript bundle.");
  const result = {
    app: destination,
    runtime: runtimeFor(root, chosen.included, mode),
    preparation,
  };
  if (mode === "go" && process.env.SPARK_RELEASE_REVISION) {
    if (!/^[a-f0-9]{40}$/.test(process.env.SPARK_RELEASE_REVISION)) throw new Error("Invalid release source revision");
    result.runtime.sourceRevision = process.env.SPARK_RELEASE_REVISION;
  }
  if (productionHash)
    result.runtime.fingerprint = digest(
      result.runtime.fingerprint + productionHash,
    );
  // prebuild can update package/config fields; cache the actual post-generation inputs.
  writeJson(
    path.join(destination, "Contents/Resources/spark-runtime.json"),
    result.runtime,
  );
  copyHelpers(root, destination, readAppConfig(root).expo?.extra?.spark?.helpers);
  if (mode === "release") {
    // Hermes is prebuilt, so Xcode's app/Pod compiler settings cannot strip it.
    const hermes = path.join(destination, "Contents/Frameworks/hermes.framework/Versions/Current/hermes");
    if (existsSync(hermes))
      await run(root, ["strip", "-S", "-x", hermes], { capture: true });
  }
  // Development apps can opt into a local identity for same-team native plugins.
  // Standalone outputs remain ad-hoc until `spark package` signs its staging copy.
  await run(
    root,
    ["codesign", "--force", "--deep", "--sign", localSigningIdentity(root, mode), destination],
    { capture: true },
  );
  writeJson(resultFile, result);
  console.log(`Built ${destination}`);
  return result;
}
