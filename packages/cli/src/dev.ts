import { installedRelease } from "./release.ts";
import { acquireRunner } from "./runner-install.ts";
import { spawnProcess } from "./process.ts";
import { windowsMetroPort, stopWindowsMetro } from "./windows-metro.ts";
import { architecture, projectPlatform } from "./platform.ts";
import { nodeCommand } from "./windows.ts";
import { readAppConfig } from "./project.ts";
import { existsSync, rmSync, watch } from "node:fs";
import path from "node:path";
import { run, cancelCommands } from "./commands.ts";
import { build } from "./build.ts";
import { createRequire } from "node:module";
const { preparePatch } = createRequire(import.meta.url)("./expo-dev-patch.cjs");
import { findGo, readRuntime, registerRuntime } from "./local.ts";
import { sessionStatus } from "./session-status.ts";
import {
  prepareConfig,
  dependencyStamp,
  goConfigurationIssues,
  incompatible,
  nativePackages,
  readJson,
  projectEnvironment,
  runtimeFor,
  stateFile,
  writeJson,
  type Runtime,
} from "./project.ts";

type BundleOptions = { dev?: boolean; minify?: boolean; https?: boolean; args?: string[] };

export async function launch(root: string, app: string, port?: number, options: BundleOptions = {}) {
  if (readRuntime(app)?.platform === "windows") {
    if (process.platform !== "win32") throw new Error("Launch the Windows runtime on Windows.");
    const nativePort = await windowsMetroPort(root, port ?? 8081, options);
    writeJson(stateFile(root, "windows-connection.json"), { port: nativePort, dev: options.dev ?? true });
    return spawnProcess([path.join(app, "MyApp.exe"), ...(options.args ?? [])], { cwd: app, env: { ...process.env, ...projectEnvironment(root), SPARK_METRO_PORT: String(nativePort), SPARK_SESSION_FILE: stateFile(root, "windows-connection.json") }, stdout: "inherit", stderr: "inherit" });
  }
  const info = await run(
    root,
    [
      "/usr/libexec/PlistBuddy",
      "-c",
      "Print :CFBundleExecutable",
      path.join(app, "Contents/Info.plist"),
    ],
    { capture: true },
  );
  const executable = path.join(app, "Contents/MacOS", info.trim());
  const runtimeFile = path.join(app, "Contents/Resources/spark-runtime.json");
  const developmentJS = options.dev ?? (!existsSync(runtimeFile) || readJson(runtimeFile).mode !== "preview");
  // Direct executable launch retains the exact product path and process ownership.
  // RN's native packager websocket reads RCT_jsLocation independently of the
  // JS bundle URL. The process argument domain avoids persistent preference edits.
  return spawnProcess(
    [executable, ...(port ? ["-RCT_jsLocation", `127.0.0.1:${port}`] : []), ...(options.args ?? [])],
    {
      cwd: root,
      env: {
        ...process.env,
        ...projectEnvironment(root),
        ...(port
          ? {
              SPARK_BUNDLE_URL: `${options.https ? "https" : "http"}://127.0.0.1:${port}/index.bundle?platform=macos&dev=${developmentJS}&minify=${options.minify ?? false}`,
            }
          : {}),
      },
      stdout: "inherit",
      stderr: "inherit",
    },
  );
}
export async function dev(
  root: string,
  goApp: string | undefined,
  expoArgs: string[] = [],
  noOpen = false,
  appArgs: string[] = [],
) {
  const platform = projectPlatform(root);
  preparePatch(root);
  let port: number | undefined;
  let bundleOptions: BundleOptions = {};
  let target: "go" | "dev" = "go";
  const settingsFile = stateFile(root, "settings.json");
  const settings = existsSync(settingsFile) ? readJson(settingsFile) : {};
  const explicitGo = !!goApp;
  goApp ??= settings.goApp;
  if (goApp) goApp = path.resolve(goApp);
  if (explicitGo) registerRuntime(goApp!);
  if (!explicitGo && settings.target === "dev") target = "dev";
  let current: { app: string; runtime: Runtime } | undefined;
  let appProcess: ReturnType<typeof spawnProcess> | undefined;
  let launchedRuntime: { app: string; fingerprint: string } | undefined;
  let busy = false;
  let status = "";
  let canBuild = false;
  let stamp = dependencyStamp(root);
  let restartPending = false;
  let reopenPending = false;
  let closing = false;
  let metro: ReturnType<typeof spawnProcess> | undefined;
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  async function startMetro() {
    prepareConfig(root);
    const previous = metro;
    metro = undefined;
    if (previous && previous.exitCode === null) {
      previous.kill();
      await previous.exited;
    }
    if (closing) return;
    let ready!: (port: number) => void;
    const started = new Promise<number>(resolve => { ready = resolve; });
    const [, expo, ...args] = nodeCommand(root, "expo", "expo", [
      "start", root, ...(port ? ["--port", String(port)] : []), ...expoArgs,
    ]);
    // Expo owns stdin and the terminal. JSON IPC carries desktop actions only;
    // reload, debugger, mobile/web actions, prompts and shutdown remain Expo's.
    const child = spawnProcess([
      "node", "--require", path.join(import.meta.dirname, "expo-dev-preload.cjs"), expo!, ...args,
    ], {
      cwd: root, env: { ...process.env, SPARK_PLATFORM: platform, SPARK_DEV_SESSION: "1" },
      stdin: "inherit", stdout: "inherit", stderr: "inherit", serialization: "json",
      ipc(message, sender) {
        if (message?.type === "spark:ready") { bundleOptions = message.options ?? {}; ready(message.port); }
        if (message?.type === "spark:action") {
          void action(message.action).then(
            () => { if (sender.exitCode === null) sender.send({ type: "spark:result", id: message.id }); },
            error => { if (sender.exitCode === null) sender.send({ type: "spark:result", id: message.id, error: String(error) }); },
          );
        }
      },
    });
    metro = child;
    child.send({ type: "spark:state", state: { target, canBuild } });
    void child.exited.then(code => {
      if (metro === child && !closing) {
        process.exitCode = code;
        close();
      }
    });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const actualPort = await Promise.race([
        started,
        child.exited.then(code => { throw new Error(`Expo exited before starting (exit ${code}). See its output above.`); }),
        new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("Expo did not become ready.")), platform === "windows" ? 180_000 : 60_000); }),
      ]);
      if (!Number.isInteger(actualPort) || actualPort < 1) throw new Error("Expo did not provide its Metro port.");
      port = actualPort;
      await check();
      restartPending = false;
    } finally { clearTimeout(timeout); }
  }
  async function check(report = false) {
    if (closing) return false;
    try { return await inspectRuntime(report); }
    catch (error) {
      current = undefined;
      canBuild = false;
      if (appProcess?.exitCode === null) { appProcess.kill(); await appProcess.exited; }
      if (closing) return false;
      const reason = String(error);
      writeJson(stateFile(root, "session.json"), { compatible: false, reason, target, port, canBuild });
      if (metro?.exitCode === null) metro.send({ type: "spark:state", state: { target, canBuild } });
      if (report || status !== reason) { status = reason; console.error(`\n› Desktop: ${reason}`); }
      return false;
    }
  }
  async function inspectRuntime(report: boolean) {
    const native = nativePackages(root);
    current = undefined;
    if (target === "go") {
      if (explicitGo) {
        const runtime = readRuntime(goApp!);
        if (runtime?.mode === "go") current = { app: goApp!, runtime };
      } else {
        current = findGo(native, goApp, platform);
        if (current) goApp = current.app;
      }
    }
    if (target === "dev" && existsSync(stateFile(root, "dev-build.json"))) {
      const record = readJson(stateFile(root, "dev-build.json"));
      const runtime = readRuntime(record.app);
      if (runtime?.mode === "dev") current = { app: record.app, runtime };
    }
    const issues = current ? incompatible(current.runtime, native, platform) : [];
    if (
      current && target === "dev" &&
      current.runtime.fingerprint !== runtimeFor(root, native, "dev").fingerprint
    ) issues.push("Native configuration or host changed.");
    if (target === "go") {
      for (let i = 0; i < issues.length; i++) {
        const name = issues[i]!;
        if (native.some((pkg) => pkg.name === name)) {
          issues[i] = current?.runtime.modules[name]
            ? `${name} has changed since this Spark Runner was built.`
            : `${name} isn’t included in the Spark Runner.`;
        }
      }
      issues.push(...goConfigurationIssues(readAppConfig(root)));
    }
    const view = sessionStatus(target, !!current, issues, appProcess?.exitCode === null, !!installedRelease()?.runners[`${platform}-${architecture(platform)}`]);
    if (view.compatible && current && appProcess?.exitCode === null &&
      (launchedRuntime?.app !== current.app || launchedRuntime.fingerprint !== current.runtime.fingerprint)) {
      // Discovery can find a different compatible binary after a native edit.
      // Relaunch before allowing that new runtime selection to serve the app.
      restartPending = true;
      appProcess.kill();
      await appProcess.exited;
      appProcess = undefined;
      reopenPending = true;
    }
    if (closing) return false;
    canBuild = view.canBuild;
    const next = view.message;
    writeJson(stateFile(root, "session.json"), {
      compatible: view.compatible,
      reason: next,
      target,
      port,
      canBuild,
    });
    // An existing HMR websocket can push code without another bundle request.
    // Stop only the process owned by this session when its native ABI is stale.
    if (!view.compatible && appProcess && appProcess.exitCode === null) {
      appProcess.kill();
      await appProcess.exited;
    }
    if (metro?.exitCode === null) metro.send({ type: "spark:state", state: { target, canBuild } });
    if (report || next !== status) {
      status = next;
      console.log(`\n› Desktop: ${status}\n${view.compatible ? "" : view.actions + "\n"}`);
    }
    return view.compatible;
  }
  async function open() {
    if (platform === "windows" ? process.platform !== "win32" : process.platform !== "darwin") {
      throw new Error(`Open ${platform} on a matching desktop host. Mobile and web remain available.`);
    }
    const localRunner = target === "go" ? findGo(nativePackages(root), goApp, platform) : undefined;
    if (target === "go" && !explicitGo && (!localRunner || incompatible(localRunner.runtime, nativePackages(root), platform).length > 0)) {
      const downloaded = await acquireRunner(platform);
      if (downloaded) goApp = downloaded;
    }
    if ((await check(true)) && current) {
      if (restartPending) await startMetro();
      if (closing) return;
      if (appProcess && appProcess.exitCode === null) {
        appProcess.kill();
        await appProcess.exited;
      }
      appProcess = await launch(root, current.app, port, { ...bundleOptions, args: appArgs });
      if (closing) { appProcess.kill(); return; }
      launchedRuntime = { app: current.app, fingerprint: current.runtime.fingerprint };
      reopenPending = false;
      await check();
    }
  }
  async function action(name: string) {
    if (busy || closing) throw new Error("Desktop runtime is busy. Try again in a moment.");
    busy = true;
    try {
      if (name === "switch") {
        target = target === "dev" ? "go" : "dev";
        if (appProcess?.exitCode === null) {
          appProcess.kill();
          await appProcess.exited;
        }
        await open();
        writeJson(settingsFile, { ...(existsSync(settingsFile) ? readJson(settingsFile) : {}), target, goApp });
      } else if (name === "build") {
        if ((await check()) || !canBuild) return;
        writeJson(stateFile(root, "session.json"), { compatible: false, reason: "Preparing custom development build" });
        if (appProcess?.exitCode === null) {
          appProcess.kill();
          await appProcess.exited;
        }
        await build(root, "dev");
        if (closing) return;
        target = "dev";
        restartPending = true;
        await open();
        writeJson(settingsFile, { ...(existsSync(settingsFile) ? readJson(settingsFile) : {}), target, goApp });
      } else if (name === "open") await open();
    } catch (error) {
      if (!closing) await check();
      throw error;
    } finally { busy = false; }
  }
  function close() {
    if (closing) return;
    closing = true;
    clearInterval(timer);
    clearTimeout(debounce);
    watcher.close();
    appProcess?.kill();
    metro?.kill();
    cancelCommands(root);
    rmSync(stateFile(root, "session.json"), { force: true });
    stopWindowsMetro(root); rmSync(stateFile(root, "windows-connection.json"), { force: true });
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    void Promise.allSettled([metro?.exited, appProcess?.exited]).then(finish);
  }
  let debounce: ReturnType<typeof setTimeout> | undefined;
  // Suspend bundle requests promptly while a package manager changes the graph.
  const watcher = watch(root, (_event, filename) => {
    if (
      !filename ||
      ![
        "package.json",
        "bun.lock",
        "package-lock.json",
        "pnpm-lock.yaml",
        "yarn.lock",
        "app.json",
        "desktop.config.json",
        "metro.config.js",
      ].includes(String(filename)) ||
      closing
    )
      return;
    writeJson(stateFile(root, "session.json"), {
      compatible: false,
      reason: "Dependencies changed; checking runtime",
    });
    restartPending = true;
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      if (!busy) void refresh();
    }, 400);
  });
  async function refresh() {
    if (busy || closing) return;
    busy = true;
    try {
      const next = dependencyStamp(root);
      if (next !== stamp) {
        restartPending = true;
        stamp = next;
      }
      const compatible = await check();
      if (restartPending) {
        const wasOpen = appProcess?.exitCode === null || reopenPending;
        await startMetro();
        // A new Metro dependency map needs a fresh app connection, not the old HMR graph.
        if (wasOpen && compatible) await open();
      }
    } catch (error) {
      writeJson(stateFile(root, "session.json"), {
        compatible: false,
        reason: String(error),
      });
      console.error(String(error));
    } finally {
      busy = false;
    }
  }
  const timer = setInterval(refresh, 2000);
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
  try {
    busy = true;
    await check();
    await startMetro();
    if (!noOpen) await open().catch(error => console.error(String(error)));
  } catch (error) {
    close();
    process.off("SIGINT", close);
    process.off("SIGTERM", close);
    throw error;
  } finally {
    busy = false;
  }
  writeJson(settingsFile, { ...(existsSync(settingsFile) ? readJson(settingsFile) : {}), target, goApp });
  await finished;
  process.off("SIGINT", close);
  process.off("SIGTERM", close);
}
