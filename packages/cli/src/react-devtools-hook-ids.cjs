// React DevTools (react-devtools-core 6.1.5 through 8.0.0, and facebook/react main) numbers each built-in hook as one,
// but React's fiber holds two hook objects for useSyncExternalStore and useTransition, and three for useActionState
// (useFormState). Editing a hook's state applies to the hook object at its id (React's overrideHookState findHook), so
// every hook after one of those edited the wrong object, and editing an effect's state unmounted the window. The patch
// numbers hooks by their objects in the fiber, as React and the Profiler's changed-hook indices do. Like Spark's other
// node_modules patches it checks the exact source, is idempotent, and replaces the file atomically. spark dev applies
// it before starting Metro (dev.ts), so it covers development builds and the Spark Runner.
const fs = require("node:fs");
const path = require("node:path");
const file = "dist/backend.js";
const counts = `// [Spark] React's fiber holds 2 hook objects for these hooks and 3 for useActionState (useFormState). Hook ids index
// that list, as overrideHookState's findHook and the Profiler's changed-hook indices do (LegendApp/legend-spark#417).
var sparkFiberHookObjects = { SyncExternalStore: 2, Transition: 2, FormState: 3, ActionState: 3 };

`;
const replacements = [
  ["function buildTree(rootStack$jscomp$0, readHookLog) {\n", `${counts}function buildTree(rootStack$jscomp$0, readHookLog) {\n`],
  [`"HostTransitionStatus" === hookStack ? null : nativeHookID++,\n`,
    `"HostTransitionStatus" === hookStack ? null : (nativeHookID += sparkFiberHookObjects[hookStack] || 1) - (sparkFiberHookObjects[hookStack] || 1), // [Spark]\n`],
];
function patchReactDevToolsHookIdsSource(source) {
  if (replacements.every(([, after]) => source.includes(after))) return source;
  if (replacements.some(([before, after]) => source.split(before).length !== 2 || source.includes(after)))
    throw new Error(`react-devtools-core's ${file} changed; review Spark's React DevTools hook id patch (packages/cli/src/react-devtools-hook-ids.cjs).`);
  return replacements.reduce((patched, [before, after]) => patched.replace(before, () => after), source);
}
/** Patches each react-devtools-core that `root`'s React Native (and React Native macOS) loads in setUpReactDevTools. */
function installReactDevToolsHookIdsPatch(root) {
  const hosts = ["react-native", "react-native-macos"].flatMap(name => {
    try { return [path.dirname(require.resolve(`${name}/package.json`, { paths: [root] }))]; } catch { return []; }
  });
  if (!hosts.length) throw new Error(`React Native is not installed in ${root}.`);
  for (const target of new Set(hosts.map(host => path.join(path.dirname(require.resolve("react-devtools-core/package.json", { paths: [host] })), file)))) {
    const source = fs.readFileSync(target, "utf8"), patched = patchReactDevToolsHookIdsSource(source);
    if (source === patched) continue;
    const temporary = `${target}.spark-${process.pid}.tmp`;
    fs.writeFileSync(temporary, patched);
    fs.renameSync(temporary, target); // Preserve package-manager cache hardlinks.
  }
}
module.exports = { patchReactDevToolsHookIdsSource, installReactDevToolsHookIdsPatch };
