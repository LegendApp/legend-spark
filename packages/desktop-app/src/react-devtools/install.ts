// Development bundles on macOS only: @legendapp/spark/runtime-entry requires this inside `if (__DEV__)`, in every
// JavaScript runtime, so release bundles contain none of it (tests/developer-menu-release.test.ts; the release-safety
// probe's DEVT-REL-06 looks for REACT_DEVTOOLS_MARKER in a release build's JavaScript).
import { REACT_DEVTOOLS_MARKER } from "./marker";

/** The parts of react-devtools-core's backend agent and global hook this uses. */
type Agent = { stopInspectingNative(selected: boolean): void; emit(event: "stopInspectingNative"): void; [REACT_DEVTOOLS_MARKER]?: true };
type Hook = { reactDevtoolsAgent?: Agent; on(event: "react-devtools", listener: (agent: Agent) => void): void };

function endInspectingEverywhere(agent: Agent) {
  if (agent[REACT_DEVTOOLS_MARKER]) return;
  agent[REACT_DEVTOOLS_MARKER] = true;
  const stop = agent.stopInspectingNative.bind(agent);
  agent.stopInspectingNative = selected => {
    stop(selected);
    agent.emit("stopInspectingNative");
  };
}

/**
 * React DevTools' Select element covers every React root of the runtime, which in Spark is every window: React Native
 * renders a ReactDevToolsOverlay in each root's AppContainer. A click in one window selects the component under it and
 * ends inspecting in that window only; the others stay covered until DevTools' Select element is pressed again. This ends
 * it in every window of the runtime (docs/devtools.md#react-devtools).
 */
export function installReactDevTools(): void {
  // React Native's setUpReactDevTools installs the hook in development bundles, before any app code runs.
  const hook = (globalThis as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: Hook }).__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (!hook) {
    console.warn("React DevTools: the global hook is missing, so Select element may leave other windows covered after a selection.");
    return;
  }
  // An agent exists already when DevTools was attached before a reload; otherwise each connection creates one.
  if (hook.reactDevtoolsAgent) endInspectingEverywhere(hook.reactDevtoolsAgent);
  hook.on("react-devtools", endInspectingEverywhere);
}
