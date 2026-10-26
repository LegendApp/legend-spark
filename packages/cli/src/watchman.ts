import { spawn } from "node:child_process";

// Metro waits on Watchman's watch-project without a timeout, so a wedged Watchman
// server leaves the app on a blank window. True when Watchman is installed but
// does not answer; a missing Watchman is Metro's ordinary Node-crawler case.
export function watchmanStalls(root: string, timeout = 10_000) {
  return new Promise<boolean>(resolve => {
    const child = spawn("watchman", ["watch-project", root], { stdio: "ignore" });
    const timer = setTimeout(() => { child.kill(); resolve(true); }, timeout);
    const done = () => { clearTimeout(timer); resolve(false); };
    child.on("error", done).on("exit", done);
  });
}
