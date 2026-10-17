// bun scripts/test-react-devtools.ts — React DevTools (Components and Profiler) against a real development session,
// headless (docs/devtools.md#react-devtools). Build first: cd examples/kitchen-sink && bun run rebuild:macos.
// Starts `spark dev --no-open` and the dev build in driver mode (scripts/testing/dev-session.ts), then speaks the React
// DevTools bridge over CDP as React Native DevTools' Components and Profiler panels do
// (scripts/testing/react-devtools-client.ts): it lists each runtime's roots, reads and edits the Kitchen Sink's
// ReactDevToolsSample, records highlight updates and a profile, and selects elements by clicking in each window.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PNG } from "pngjs";
import type { Driver } from "./e2e/driver.ts";
import { startDevSession } from "./testing/dev-session.ts";
import { connectReactDevTools, type Element } from "./testing/react-devtools-client.ts";

const dev = await startDevSession({ prefix: "ks-react-devtools-" });
const ID = "devtools-react-devtools";
const pass = (message: string) => console.log(`PASS ${message}`);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
type Client = Awaited<ReturnType<typeof connectReactDevTools>>;

/** The text of the first view with `testID`, as the driver's accessibility view reads it. */
async function text(driver: Driver, testID: string) {
  return (await driver.elements()).elements.find(element => element.id === testID)?.text;
}
/** A click at the center of the view with `testID`, in its window, wherever the click lands (the inspector's overlay covers the window). */
async function clickThrough(driver: Driver, testID: string) {
  const { window, frame } = await driver.waitFor(testID);
  await driver.tap({ point: { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 }, window: `id:${window}` });
}
/** Select element: the frontend starts inspecting, a click in a window selects the element under it, inspecting stops. */
async function select(client: Client, driver: Driver, testID: string) {
  const mark = client.mark();
  await client.send("startInspectingHost");
  // The backend asks every root's ReactDevToolsOverlay to cover its window before the click.
  await sleep(500);
  await clickThrough(driver, testID);
  const id = await client.next("selectElement", () => true, mark) as number;
  assert.equal(await client.next("stopInspectingHost", () => true, mark), true, "the click ends inspecting with a selection");
  const selected = client.elements.get(id);
  assert.ok(selected, `the selected element ${id} is in the tree`);
  const { owners, props } = await client.inspect(selected);
  return { selected, owners: (owners as { displayName: string }[]).map(owner => owner.displayName), props: props.data };
}
const rootName = (client: Client, root: number) => client.elements.get(client.elements.get(root)!.children[0]!)?.name;
const rootOf = (client: Client, item: Element) => rootName(client, item.root);
/** Pixels of a capture in React DevTools' highlight-update colors (react-devtools-shared views/TraceUpdates). */
function traceColorPixels(file: string) {
  const colors = ["#37afa9", "#63b19e", "#80b393", "#97b488", "#abb67d", "#beb771", "#cfb965", "#dfba57", "#efbb49", "#febc38"]
    .map(hex => [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16)));
  const { data, width, height } = PNG.sync.read(readFileSync(file));
  let count = 0;
  for (let i = 0; i < width * height * 4; i += 4)
    if (colors.some(([r, g, b]) => Math.abs(data[i]! - r!) + Math.abs(data[i + 1]! - g!) + Math.abs(data[i + 2]! - b!) < 24)) count++;
  return count;
}

try {
  const { driver, name } = await dev.launch();
  await driver.navigate("spark-ks://devtools/react-devtools");
  await driver.waitFor(`${ID}-sample`, 60000);
  const sharedTarget = await dev.target(`${name} (shared runtime)`);
  const cdp = await dev.connect(sharedTarget);
  await cdp.send("Runtime.enable");

  // 1. Connect as the Components panel does, list the roots and find a known component.
  const shared = await connectReactDevTools(cdp, dev.until);
  const sample = await shared.element(item => item.name === "ReactDevToolsSample", "ReactDevToolsSample");
  assert.equal(rootOf(shared, sample), "main(RootComponent)");
  assert.ok(shared.ancestors(sample).some(item => item.name === "ReactDevTools"), "ReactDevToolsSample renders inside the ReactDevTools screen");
  pass(`components: the shared runtime's backend lists roots ${JSON.stringify([...shared.roots.keys()].map(root => rootName(shared, root)))}; ReactDevToolsSample is element ${sample.id} under main(RootComponent)`);

  // 2. Props, state and hooks of the known component.
  const inspected = await shared.inspect(sample);
  assert.equal(inspected.props.data.label, "Sample label");
  assert.equal(inspected.canEditHooks, true);
  assert.equal(inspected.canEditFunctionProps, true);
  const hooks = (list: any[]): any[] => list.flatMap(hook => [hook, ...hooks(hook.subHooks ?? [])]);
  const state = hooks(inspected.hooks.data).find(hook => hook.name === "State" && hook.isStateEditable);
  assert.ok(state, "the useSampleCount hook's useState is listed and editable");
  assert.equal(state.value, 0);
  assert.ok(hooks(inspected.hooks.data).some(hook => hook.name === "SampleCount"), "custom hooks are listed by name (SampleCount)");
  // useI18n's useSyncExternalStore comes first; React keeps it as two hook objects, so the state is the third (#417).
  const store = hooks(inspected.hooks.data).find(hook => hook.name === "SyncExternalStore");
  assert.ok(store, "the useI18n hook's useSyncExternalStore is listed");
  assert.equal(state.id, store.id + 2, "hook ids count React's hook objects (useSyncExternalStore has two)");
  pass(`props/state/hooks: label "${inspected.props.data.label}", hooks ReactDevToolsMessages > I18n > AppState > SyncExternalStore (id ${store.id}), SampleCount > State (id ${state.id}) = ${state.value}`);

  // 3. Editing a prop and a hook's state re-renders the app.
  await shared.send("overrideValueAtPath", { type: "props", id: sample.id, rendererID: sample.rendererID, path: ["label"], value: "Edited label" });
  await dev.until(async () => (await text(driver, `${ID}-label`)) === "Edited label", "the edited label prop renders");
  await shared.send("overrideValueAtPath", { type: "hooks", id: sample.id, rendererID: sample.rendererID, hookID: state.id, path: [], value: 41 });
  await dev.until(async () => (await text(driver, `${ID}-count`)) === "Count: 41", "the edited count state renders");
  const edited = await shared.inspect(sample);
  assert.equal(edited.props.data.label, "Edited label");
  assert.equal(hooks(edited.hooks.data).find(hook => hook.id === state.id)?.value, 41, "the edited hook holds the new state");
  assert.ok(await text(driver, `${ID}-increment`), "the window still renders the sample after the edit");
  pass("editing: overrideValueAtPath set the label prop and the count state after a useSyncExternalStore, and the app rendered both");

  // 4. Highlight updates: the backend reports the updated host views and the window's DebuggingOverlay draws them.
  await cdp.evaluate("globalThis.__ksTraceUpdates = []; __REACT_DEVTOOLS_GLOBAL_HOOK__.reactDevtoolsAgent.addListener('drawTraceUpdates', nodes => globalThis.__ksTraceUpdates.push(nodes.length)), 0");
  const before = traceColorPixels((await driver.capture("main", "react-devtools-before")).file);
  await shared.send("setTraceUpdatesEnabled", true);
  await driver.tap({ testID: `${ID}-increment` });
  await dev.until(async () => (await cdp.evaluate("globalThis.__ksTraceUpdates.length")) > 0, "drawTraceUpdates");
  const after = traceColorPixels((await driver.capture("main", "react-devtools-after")).file);
  await shared.send("setTraceUpdatesEnabled", false);
  assert.ok(after > before + 40, `the window shows highlight outlines (${before} → ${after} highlight-colored pixels)`);
  pass(`highlight updates: drawTraceUpdates for ${await cdp.evaluate("globalThis.__ksTraceUpdates[0]")} views; the main window's capture gained ${after - before} highlight-colored pixels`);

  // 5. Profiler: commit timings for two state updates.
  let mark = shared.mark();
  await shared.send("startProfiling", { recordChangeDescriptions: true, recordTimeline: false });
  assert.equal(await shared.next("profilingStatus", () => true, mark), true);
  for (const count of [43, 44]) {
    await driver.tap({ testID: `${ID}-increment` });
    await dev.until(async () => (await text(driver, `${ID}-count`)) === `Count: ${count}`, `Count: ${count} renders`);
  }
  mark = shared.mark();
  await shared.send("stopProfiling");
  assert.equal(await shared.next("profilingStatus", () => true, mark), false);
  mark = shared.mark();
  await shared.send("getProfilingData", { rendererID: sample.rendererID });
  const profile = await shared.next("profilingData", () => true, mark);
  const root = profile.dataForRoots.find((item: { rootID: number }) => item.rootID === sample.root);
  const commits = (root.commitData as { duration: number; timestamp: number; fiberActualDurations: [number, number][]; changeDescriptions: [number, any][] | null }[])
    .filter(commit => commit.fiberActualDurations.some(([id]) => id === sample.id));
  assert.ok(commits.length >= 2, `two commits render ReactDevToolsSample (${commits.length}): ${JSON.stringify(root.commitData.map((commit: any) => [commit.duration, commit.fiberActualDurations.length, commit.changeDescriptions?.length])).slice(0, 500)}`);
  for (const commit of commits) assert.ok(commit.duration >= 0 && commit.timestamp > 0);
  const change = commits[0]!.changeDescriptions?.find(([id]) => id === sample.id)?.[1];
  assert.deepEqual(change?.hooks, [state.id], "the change description names the count hook");
  pass(`profiler: ${root.commitData.length} commits recorded, ${commits.length} render ReactDevToolsSample (${commits.map(commit => `${commit.duration.toFixed(2)} ms`).join(", ")}), changed hook ${JSON.stringify(change.hooks)}`);

  // 6. Select element in the main window.
  const main = await select(shared, driver, `${ID}-count`);
  assert.equal(main.selected.name, "Text");
  assert.equal(main.props.testID, `${ID}-count`);
  assert.ok(main.owners.includes("ReactDevToolsSample"));
  pass(`select element: a click on the count selects ${main.selected.name} (owners ${main.owners.slice(0, 3).join(" < ")}) in ${rootOf(shared, main.selected)}`);

  // 7. A second window is a second root of the same runtime; Select element covers every window and stops in all.
  await driver.tap({ testID: `${ID}-open-note` });
  await driver.waitFor("multiwindow-note-stars", 30000);
  const note = await shared.element(item => item.name === "NoteWindow", "NoteWindow");
  assert.notEqual(note.root, sample.root);
  assert.equal(shared.roots.size >= 2, true);
  const inNote = await select(shared, driver, "multiwindow-note-stars");
  assert.ok(inNote.owners.includes("NoteWindow"), `owners ${inNote.owners.join(" < ")}`);
  assert.equal(inNote.selected.root, note.root);
  // Every window's overlay is gone: a click in the main window reaches its button again.
  await driver.tap({ testID: `${ID}-increment` });
  await dev.until(async () => (await text(driver, `${ID}-count`)) === "Count: 45", "the main window takes clicks after a selection in the note window");
  pass(`multiple windows: roots ${JSON.stringify([...shared.roots.keys()].map(item => rootName(shared, item)))}; a click in the note window selected ${inNote.selected.name} under NoteWindow (${rootOf(shared, inNote.selected)}), and inspecting stopped in every window`);

  // 8. An isolated runtime is its own target with its own backend and its window's root.
  await driver.tap({ testID: `${ID}-open-isolated` });
  await driver.waitFor("multiwindow-isolated-runtime", 120000);
  const isolatedTarget = await dev.target(`${name} (isolated runtime: ks-plugins)`);
  const isolatedCdp = await dev.connect(isolatedTarget);
  await isolatedCdp.send("Runtime.enable");
  const isolated = await connectReactDevTools(isolatedCdp, dev.until);
  const panel = await isolated.element(item => item.name === "IsolatedPanelContent", "IsolatedPanelContent");
  assert.equal(isolated.roots.size, 1, "the isolated runtime has one root");
  assert.equal((await isolated.inspect(panel)).props.data.label, "React DevTools");
  assert.equal([...isolated.elements.values()].some(item => item.name === "ReactDevToolsSample"), false, "the isolated runtime's tree holds only its own root");
  const inIsolated = await select(isolated, driver, "multiwindow-isolated-runtime");
  assert.ok(inIsolated.owners.includes("IsolatedPanelContent"), `owners ${inIsolated.owners.join(" < ")}`);
  pass(`isolated runtime: target "${isolatedTarget.title}" lists one root (${rootName(isolated, panel.root)}) with IsolatedPanelContent (label "React DevTools"); a click in its window selected ${inIsolated.selected.name}`);
} catch (error) {
  dev.printLogs();
  throw error;
} finally {
  await dev.close();
}
