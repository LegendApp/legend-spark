import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, vi } from "vitest";
import { DriverBackend } from "../scripts/e2e/runner/driver-backend.ts";
import { PointerBackend } from "../scripts/e2e/runner/pointer-backend.ts";
import { runFlows } from "../scripts/e2e/runner/executor.ts";
import { runCommand } from "../scripts/e2e/runner/run.ts";
import { FakeApp } from "./e2e-driver-fake.ts";

const native = vi.hoisted(() => ({ calls: [] as string[][], denied: false }));
vi.mock("node:child_process", async importOriginal => ({
  ...await importOriginal<typeof import("node:child_process")>(),
  execFile: (file: string, args: string[], _options: unknown, callback: (error: unknown, stdout: string) => void) => {
    native.calls.push([file, ...args]);
    callback(native.denied && args[0] === "check" ? Object.assign(new Error("denied"), { stderr: "E_PERMISSION_DENIED: Accessibility permission is required" }) : null, "");
  },
}));

async function run(command: string, flows = 1) {
  native.calls = [];
  const dir = mkdtempSync(path.join(tmpdir(), "e2e-pointer-"));
  mkdirSync(path.join(dir, "flows"));
  const file = path.join(dir, "flows/test.yaml");
  writeFileSync(file, `appId: so.legend.spark.examples.kitchensink\nname: Pointer\nintent: A real click.\n---\n- launchApp\n${command}\n`);
  const app = new FakeApp({ target: 1 }), driver = new DriverBackend(app);
  const results = await runFlows(Array.from({ length: flows }, () => file), { backends: [driver, new PointerBackend(driver)], runDir: path.join(dir, "run") });
  return { result: results[0]!, results, app };
}

test.skipIf(process.platform !== "darwin")("tapOn resolves an element on the OS backend, translates its center once, and posts once", async () => {
  native.denied = false;
  const { result, app } = await run("- tapOn: { id: target }");
  expect(result.status, JSON.stringify(result.failure)).toBe("passed");
  expect(app.log.filter(line => line.startsWith("pointerEvents"))).toEqual(["pointerEvents id:spark.main 60,40"]);
  expect(native.calls.slice(1).map(call => call.slice(1))).toEqual([["check"], ["123", "down-event", "up-event"]]);
  expect(app.log.slice(-4)).toEqual(["restorePointer", "quit", "close", "app close"]);
});

test.skipIf(process.platform !== "darwin")("missing permission fails at flow start before launching or showing the app", async () => {
  native.denied = true;
  const { result, app } = await run("- tapOn: { id: target }");
  expect(result.failure).toMatchObject({ kind: "error", message: "E_PERMISSION_DENIED: Accessibility permission is required" });
  expect(app.log.some(line => line.startsWith("pointerEvents"))).toBe(false);
  expect(native.calls).toHaveLength(2);
  expect(app.log).toEqual(["open", "app close"]);
});

test.skipIf(process.platform !== "darwin")("unsupported modifiers fail before posting input", async () => {
  native.denied = false;
  const { result } = await run("- tapOn: { id: target, modifiers: [shift] }");
  expect(result.failure).toMatchObject({ kind: "unsupported", message: "pointer tapOn does not support modifiers" });
  expect(native.calls.slice(1).map(call => call.slice(1))).toEqual([["check"]]);
});

test.skipIf(process.platform !== "darwin")("each flow preflights once and shares the compiled helper, including explicit points", async () => {
  native.denied = false;
  const { results, app } = await run("- tapOn: { point: '25%,75%', within: { id: target } }\n- tapOn: { id: target }", 2);
  expect(results.map(result => result.status), JSON.stringify(results.map(result => result.failure), null, 2)).toEqual(["passed", "passed"]);
  expect(native.calls.filter(call => call[0] === "clang")).toHaveLength(1);
  expect(native.calls.filter(call => call[1] === "check")).toHaveLength(2);
  expect(app.log.filter(line => line.startsWith("pointerEvents"))).toEqual([
    "pointerEvents id:spark.main 35,50", "pointerEvents id:spark.main 60,40",
    "pointerEvents id:spark.main 35,50", "pointerEvents id:spark.main 60,40",
  ]);
  expect(app.log.filter(line => line === "restorePointer")).toHaveLength(2);
});

test.skipIf(process.platform !== "darwin")("pointer state is restored after a tap when a later assertion fails", async () => {
  native.denied = false;
  const { result, app } = await run("- tapOn: { id: target }\n- assertNotVisible: { id: target, timeout: 20ms }");
  expect(result.failure?.kind).toBe("assertion");
  expect(app.log.slice(-4)).toEqual(["restorePointer", "quit", "close", "app close"]);
});

test("--pointer requires a driver session rather than starting a second app", async () => {
  const errors: string[] = [];
  expect(await runCommand(["--pointer"], { backends: { other: () => ({ name: "other" } as never) }, stdout: () => {}, stderr: line => errors.push(line) })).toBe(2);
  expect(errors).toEqual(["--pointer requires the driver backend"]);
});
