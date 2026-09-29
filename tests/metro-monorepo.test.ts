import { expect, test, vi } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";

const { withDesktop } = createRequire(import.meta.url)("../packages/cli/src/metro.cjs");
const workspace = path.resolve("/workspace");
const project = path.join(workspace, "apps", "desktop app");

test("desktop entry aliases preserve workspace-relative lazy bundle URLs", () => {
  const rewrite = vi.fn((url: string) => url);
  const config = withDesktop({ projectRoot: project, server: {
    unstable_serverRoot: workspace, rewriteRequestUrl: rewrite,
  } }, { runtimes: false });
  expect(config.server.unstable_serverRoot).toBe(workspace);
  const request = config.server.rewriteRequestUrl;
  expect(request("/index.bundle?platform=macos&lazy=true")).toBe("/apps/desktop%20app/index.bundle?platform=macos&lazy=true");
  expect(request("http://localhost:8081/.threaded-runtime/entry.bundle?platform=windows")).toBe("http://localhost:8081/apps/desktop%20app/.threaded-runtime/entry.bundle?platform=windows");
  expect(request("/index.map?platform=macos")).toBe("/apps/desktop%20app/index.map?platform=macos");
  // Shared-source chunks must stay workspace-relative, with no ../ traversal
  // that a URL client would normalize back into the wrong project directory.
  const shared = "/packages/documents/Editor.bundle?platform=macos&modulesOnly=true";
  expect(request(shared)).toBe(shared);
  expect(request("/index.bundle?platform=ios")).toBe("/index.bundle?platform=ios");
  expect(request("/index.bundle?platform=web")).toBe("/index.bundle?platform=web");
  expect(rewrite).toHaveBeenCalledWith(shared);
});

test("standalone apps keep their existing host entry URLs", () => {
  const config = withDesktop({ projectRoot: project }, { runtimes: false });
  expect(config.server.unstable_serverRoot).toBe(project);
  expect(config.server.rewriteRequestUrl("/index.bundle?platform=macos")).toBe("/index.bundle?platform=macos");
});

test("desktop Metro options do not silently forward typos to the runtime library", () => {
  expect(() => withDesktop({ projectRoot: project }, { runtiems: false })).toThrow("Unknown desktop Metro option");
  expect(() => withDesktop({ projectRoot: project }, { watch: "yes" })).toThrow("watch must be boolean");
});
