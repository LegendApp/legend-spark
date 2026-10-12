import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, vi } from "vitest";
import { installReactDevTools } from "../packages/desktop-app/src/react-devtools/install.ts";
import { REACT_DEVTOOLS_MARKER } from "../packages/desktop-app/src/react-devtools/marker.ts";
import { codeProblems } from "../scripts/e2e/runner/driver-release.ts";

type Listener = (agent: FakeAgent) => void;
class FakeAgent {
  sent: boolean[] = [];
  emitted: string[] = [];
  stopInspectingNative = (selected: boolean) => { this.sent.push(selected); };
  emit(event: string) { this.emitted.push(event); }
}
function withHook(hook: object | undefined, run: () => void) {
  const global = globalThis as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: object };
  const previous = global.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  global.__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook;
  try { run(); } finally { global.__REACT_DEVTOOLS_GLOBAL_HOOK__ = previous; }
}

test("a selection in one window ends Select element in every root of the runtime, for the current and every later agent", () => {
  const listeners: Listener[] = [];
  const current = new FakeAgent();
  withHook({ reactDevtoolsAgent: current, on: (event: string, listener: Listener) => { expect(event).toBe("react-devtools"); listeners.push(listener); } }, installReactDevTools);
  current.stopInspectingNative(true);
  // The frontend still hears about the selection, and every ReactDevToolsOverlay stops inspecting.
  expect(current.sent).toEqual([true]);
  expect(current.emitted).toEqual(["stopInspectingNative"]);

  const later = new FakeAgent();
  for (const listener of listeners) listener(later);
  listeners[0]!(later); // the same agent announced twice is wrapped once
  expect((later as unknown as Record<string, unknown>)[REACT_DEVTOOLS_MARKER]).toBe(true);
  later.stopInspectingNative(false);
  expect(later.sent).toEqual([false]);
  expect(later.emitted).toEqual(["stopInspectingNative"]);
});

test("without React DevTools' global hook it warns and changes nothing", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  try {
    withHook(undefined, installReactDevTools);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("React DevTools: the global hook is missing"));
  } finally { warn.mockRestore(); }
});

/** A .app bundle whose Contents/Resources holds `scripts` (relative path → contents). */
function appBundle(scripts: Record<string, string | Buffer>) {
  const app = path.join(mkdtempSync(path.join(tmpdir(), "react-devtools-release-")), "KitchenSink.app");
  mkdirSync(path.join(app, "Contents/Resources"), { recursive: true });
  for (const [name, contents] of Object.entries(scripts)) {
    mkdirSync(path.dirname(path.join(app, "Contents/Resources", name)), { recursive: true });
    writeFileSync(path.join(app, "Contents/Resources", name), contents);
  }
  return app;
}
// Hermes bytecode keeps string literals as bytes; a stand-in with the magic number, binary data and the text.
const HBC = (text: string) => Buffer.concat([Buffer.from([0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f, 0, 0, 0, 96]), Buffer.from(text, "utf8"), Buffer.from([0, 255])]);

/** The JavaScript findings only: these stand-in apps have no native code. */
const scriptProblems = (app: string) => codeProblems(app).filter(problem => !problem.startsWith("no native code"));

test("JavaScript that contains React DevTools' backend or Spark's Select element fix is a finding, at any depth; an app without JavaScript fails closed (DEVT-REL-06)", () => {
  // A release React renderer still names the hook it would report to; that is not the backend.
  expect(scriptProblems(appBundle({ "main.jsbundle": HBC("__REACT_DEVTOOLS_GLOBAL_HOOK__ injectIntoDevTools") }))).toEqual([]);
  expect(scriptProblems(appBundle({
    "main.jsbundle": HBC("global.__FUSEBOX_REACT_DEVTOOLS_DISPATCHER__"),
    "workers/entry.hbc": HBC(`connectWithCustomMessagingProtocol agent[${REACT_DEVTOOLS_MARKER}]`),
    "notes.txt": "__FUSEBOX_REACT_DEVTOOLS_DISPATCHER__",
  }))).toEqual([
    "Contents/Resources/main.jsbundle contains the React DevTools backend (__FUSEBOX_REACT_DEVTOOLS_DISPATCHER__)",
    "Contents/Resources/workers/entry.hbc contains the React DevTools backend (connectWithCustomMessagingProtocol)",
    `Contents/Resources/workers/entry.hbc contains the React DevTools Select element fix (${REACT_DEVTOOLS_MARKER})`,
  ]);
  const empty = appBundle({});
  expect(scriptProblems(empty)).toEqual([`no JavaScript bundle found in ${empty} to check for the network inspector, the profiler, the React DevTools backend and the React DevTools Select element fix`]);
});
