import { spawnProcess, which } from "./process.ts";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Check the actual Node/Expo pair before handing work to Expo Desktop. */
export async function checkExpoDesktopNode(root: string) {
  const requireApp = createRequire(path.join(root, "package.json"));
  const requireDesktop = createRequire(requireApp.resolve("expo-desktop/package.json"));
  const configPlugins = pathToFileURL(requireDesktop.resolve("@expo/config-plugins")).href;
  const node = which("node");
  if (!node) throw new Error("Missing node. Install Node 24.19.0 (the version in .nvmrc), then retry.");
  // Use the static named imports used by Expo Desktop. Older Node releases cannot
  // discover these exports in Expo's Babel-generated CommonJS modules.
  const child = spawnProcess([node, "--input-type=module", "-e",
    `import { AndroidConfig, IOSConfig } from ${JSON.stringify(configPlugins)}; if (!AndroidConfig || !IOSConfig) throw new Error('Missing Expo config exports');`,
  ], { cwd: root, stdout: "ignore", stderr: "pipe" });
  const [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited]);
  if (code !== 0) throw new Error(
    `Expo Desktop could not load its config plugins using ${node}. Use Node 24.19.0 (nvm install && nvm use from the framework checkout), then retry. Node 24.12.0 cannot import these CommonJS named exports.\n${stderr.trim()}`,
  );
}
