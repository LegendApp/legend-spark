// The App Sandbox's effect on what Spark's APIs reach (docs/app-sandbox.md), observed in a real sandboxed process:
// tests/app-sandbox.native.mm, signed ad hoc with the sandbox entitlements as `spark build --sandbox` signs an app, once
// with com.apple.security.network.client and once without. Its container (~/Library/Containers/<test id>) is reused.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { runOk } from "./subprocess.ts";

const value = (item: unknown): string => typeof item === "boolean" ? `<${item}/>` : Array.isArray(item) ? `<array>${item.map(value).join("")}</array>` : `<string>${item}</string>`;
const plist = (entries: Record<string, unknown>) => `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>${Object.entries(entries)
  .map(([key, item]) => `<key>${key}</key>${value(item)}`).join("")}</dict></plist>`;
const ID = "so.legend.spark.tests.app-sandbox";

test.skipIf(process.platform !== "darwin")("a sandboxed process: container home and temporary directory, files outside denied to it and its children, network by entitlement, hot keys, Apple events only to apps a temporary exception names", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-app-sandbox-"));
  const server = createServer(socket => socket.end());
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const root = path.resolve(import.meta.dirname, ".."), output = path.join(directory, "app-sandbox");
    writeFileSync(path.join(directory, "Info.plist"), plist({ CFBundleIdentifier: ID, CFBundleName: "app-sandbox" }));
    await runOk("clang++", ["-std=c++17", "-fobjc-arc", "-framework", "Foundation", "-framework", "Carbon", "-framework", "CoreServices", "-framework", "Security",
      "-I", path.join(root, "packages/desktop-app/macos"), "-sectcreate", "__TEXT", "__info_plist", path.join(directory, "Info.plist"),
      path.join(root, "packages/desktop-app/macos/SparkSandbox.mm"), path.join(root, "tests/app-sandbox.native.mm"), "-o", output]);
    const port = String((server.address() as { port: number }).port), home = os.homedir();
    let signings = 0;
    const facts = async (entitlements: Record<string, unknown>) => {
      const signed = `${output}-${++signings}`;
      writeFileSync(`${signed}.entitlements`, plist(entitlements));
      await runOk("cp", [output, signed]);
      await runOk("codesign", ["--force", "--sign", "-", "--entitlements", `${signed}.entitlements`, signed]);
      return JSON.parse(await runOk(signed, [home, port]));
    };
    const container = path.join(home, "Library/Containers", ID, "Data");
    const sandboxed = { sandboxed: true, home: container, temporary: `${container}/tmp/`, writeOwn: "ok", listOutside: "Operation not permitted", childHome: container, hotKey: 0, listen: "Operation not permitted" };
    const entitled = await facts({ "com.apple.security.app-sandbox": true, "com.apple.security.network.client": true });
    expect(entitled).toMatchObject({ ...sandboxed, connect: "ok" });
    expect(entitled.childListOutside).not.toBe(0);
    const bare = await facts({ "com.apple.security.app-sandbox": true });
    expect(bare).toMatchObject({ ...sandboxed, connect: "Operation not permitted" });
    const automating = await facts({ "com.apple.security.app-sandbox": true, "com.apple.security.automation.apple-events": true });
    // Apple events: the sandbox answers procNotFound (-600), even with com.apple.security.automation.apple-events, until a
    // temporary exception names the target app; then (as unsandboxed) the automation permission decides, -1744 asking
    // for consent where nobody granted it. No prompt is shown: the probe never asks the user.
    const exception = await facts({ "com.apple.security.app-sandbox": true, "com.apple.security.automation.apple-events": true, "com.apple.security.temporary-exception.apple-events": ["com.apple.finder"] });
    const unsandboxed = await facts({});
    expect([entitled.automation, bare.automation, automating.automation]).toEqual([-600, -600, -600]);
    expect([exception.automation, unsandboxed.automation]).not.toContain(-600);
  } finally {
    server.close();
    rmSync(directory, { recursive: true, force: true });
  }
}, 60_000);
