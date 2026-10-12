import { expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { macOSReleasePathSettings, macOSReleaseSettings, sourceRoot } from "../packages/cli/src/macos-release.ts";
import { formatNotices, npmNotice } from "../packages/cli/src/notices.ts";
import { noticesFindings } from "../scripts/e2e/audit/bundle.ts";
import { runtimeFor, writeJson } from "../packages/cli/src/project.ts";

test("compiler policy changes invalidate macOS releases without invalidating development or Windows", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-release-policy-"));
  const original = [...macOSReleaseSettings];
  try {
    writeJson(path.join(root, "package.json"), { name: "app", dependencies: {} });
    for (const platform of ["macos", "windows"]) {
      writeJson(path.join(root, "app.json"), { expo: { name: "App", platforms: [platform] } });
      const modes = ["go", "dev", "preview", "release"];
      const before = modes.map(mode => runtimeFor(root, [], mode).fingerprint);
      macOSReleaseSettings.push("TEST_COMPILER_POLICY=changed");
      for (const [index, mode] of modes.entries()) {
        const after = runtimeFor(root, [], mode).fingerprint;
        if (platform === "macos" && mode === "release") expect(after).not.toBe(before[index]);
        else expect(after).toBe(before[index]);
      }
      macOSReleaseSettings.splice(0, macOSReleaseSettings.length, ...original);
    }
  } finally {
    macOSReleaseSettings.splice(0, macOSReleaseSettings.length, ...original);
    rmSync(root, { recursive: true, force: true });
  }
});

test("release builds map source paths from the workspace root, or the app when it is in none", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-release-paths-"));
  try {
    const app = path.join(root, "apps/desk");
    writeJson(path.join(app, "package.json"), { name: "desk" });
    expect(sourceRoot(app)).toBe(app);
    writeJson(path.join(root, "package.json"), { name: "repo", workspaces: ["apps/*"] });
    expect(sourceRoot(app)).toBe(root);
    expect(macOSReleasePathSettings(app)).toEqual([`OTHER_CFLAGS=$(inherited) "-ffile-prefix-map=${root}=."`, `OTHER_CPLUSPLUSFLAGS=$(inherited) "-ffile-prefix-map=${root}=."`]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("third-party notices name each package with its license and text, and refuse a package without either", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-notices-"));
  try {
    const pkg = (name: string, manifest: object, license?: string) => {
      writeJson(path.join(root, name, "package.json"), { name, version: "1.0.0", ...manifest });
      if (license) writeFileSync(path.join(root, name, "LICENSE"), license);
      return path.join(root, name);
    };
    expect(npmNotice(pkg("left-pad", { license: "WTFPL" }, "Do what you want.\n"))).toEqual({ name: "left-pad", version: "1.0.0", license: "WTFPL", text: "Do what you want.", source: "npm" });
    expect(npmNotice(pkg("no-text", { license: "MIT" }))).toEqual({ name: "no-text", version: "1.0.0", license: "MIT", source: "npm" });
    expect(() => npmNotice(pkg("unlicensed", {}))).toThrow(/unlicensed@1\.0\.0 .* declares no license and has no license file/);
    const text = formatNotices("Desk", [npmNotice(path.join(root, "left-pad")), { name: "fmt", license: "MIT", text: "fmt license", source: "CocoaPods" }]);
    expect(text).toBe("Third-party software notices for Desk\n\nDesk includes the following third-party software.\n\n## left-pad 1.0.0\nLicense: WTFPL\nSource: npm\n\nDo what you want.\n\n## fmt\nLicense: MIT\nSource: CocoaPods\n\nfmt license\n");
    expect(noticesFindings(text, ["Contents/Frameworks/fmt.framework/Versions/A/fmt"])).toEqual({ findings: [], evidence: ["2 packages, each with a license"] });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
