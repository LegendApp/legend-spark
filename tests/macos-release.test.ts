import { expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { macOSReleasePathSettings, macOSReleaseSettings, removeLocalNetworking, sourceRoot } from "../packages/cli/src/macos-release.ts";
import { collectNotices, formatNotices, isFirstParty, npmNotice } from "../packages/cli/src/notices.ts";
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

test("third-party notices name each package with its license and text, and list a package without either as UNKNOWN", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "spark-notices-"));
  try {
    const pkg = (name: string, manifest: object, license?: string) => {
      writeJson(path.join(root, name, "package.json"), { name, version: "1.0.0", ...manifest });
      if (license) writeFileSync(path.join(root, name, "LICENSE"), license);
      return path.join(root, name);
    };
    expect(npmNotice(pkg("left-pad", { license: "WTFPL" }, "Do what you want.\n"))).toEqual({ name: "left-pad", version: "1.0.0", license: "WTFPL", text: "Do what you want.", source: "npm" });
    expect(npmNotice(pkg("no-text", { license: "MIT" }))).toEqual({ name: "no-text", version: "1.0.0", license: "MIT", source: "npm" });
    expect(npmNotice(pkg("unlicensed", {}))).toEqual({ name: "unlicensed", version: "1.0.0", license: "UNKNOWN", source: "npm" });
    expect(noticesFindings(formatNotices("Desk", [npmNotice(path.join(root, "unlicensed"))]), []).findings).toEqual(["unlicensed 1.0.0: no license"]);
    const text = formatNotices("Desk", [npmNotice(path.join(root, "left-pad")), { name: "fmt", license: "MIT", text: "fmt license", source: "CocoaPods" }]);
    expect(text).toBe("Third-party software notices for Desk\n\nDesk includes the following third-party software.\n\n## left-pad 1.0.0\nLicense: WTFPL\nSource: npm\n\nDo what you want.\n\n## fmt\nLicense: MIT\nSource: CocoaPods\n\nfmt license\n");
    expect(noticesFindings(text, ["Contents/Frameworks/fmt.framework/Versions/A/fmt"])).toEqual({ findings: [], evidence: ["2 packages, each with a license"] });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("notices leave out first-party packages: private ones and workspace packages outside node_modules", () => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "spark-notices-workspace-")));
  try {
    // A legend-apps-like monorepo: workspace packages with no license, one private and one not, and a dependency.
    writeJson(path.join(root, "package.json"), { name: "repo", private: true, workspaces: ["apps/*", "packages/*"] });
    const app = path.join(root, "apps/desk"), shared = path.join(root, "packages/shared"), unpublished = path.join(root, "packages/document-app");
    const dependency = path.join(root, "node_modules/left-pad"), linked = path.join(root, "node_modules/@repo/shared");
    writeJson(path.join(app, "package.json"), { name: "@repo/desk", private: true });
    writeJson(path.join(shared, "package.json"), { name: "@repo/shared", private: true });
    writeJson(path.join(unpublished, "package.json"), { name: "@repo/document-app" });
    writeJson(path.join(dependency, "package.json"), { name: "left-pad", version: "1.0.0", license: "MIT" });
    mkdirSync(path.dirname(linked), { recursive: true });
    symlinkSync(shared, linked);
    for (const [dir, file] of [[app, "index.ts"], [shared, "index.ts"], [unpublished, "index.ts"], [dependency, "index.js"]] as const) writeFileSync(path.join(dir, file), "");
    const sources = [path.join(app, "index.ts"), path.join(linked, "index.ts"), path.join(unpublished, "index.ts"), path.join(dependency, "index.js")];
    expect(collectNotices(app, sources, [unpublished], []).map(notice => notice.name)).toEqual(["left-pad"]);
    expect([isFirstParty(unpublished, root), isFirstParty(dependency, root)]).toEqual([true, false]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// The config plugin allows local networking for the development server; release builds lose it (#274).
test.skipIf(process.platform !== "darwin")("release builds drop NSAllowsLocalNetworking from Info.plist and keep every other App Transport Security key", () => {
  const app = mkdtempSync(path.join(os.tmpdir(), "spark-ats-")), plist = path.join(app, "Contents/Info.plist");
  const write = (value: object) => { mkdirSync(path.dirname(plist), { recursive: true }); writeFileSync(plist, JSON.stringify(value)); execFileSync("plutil", ["-convert", "xml1", plist]); };
  const read = () => JSON.parse(execFileSync("plutil", ["-convert", "json", "-o", "-", plist], { encoding: "utf8" }));
  try {
    write({ CFBundleIdentifier: "com.example.app", NSAppTransportSecurity: { NSAllowsLocalNetworking: true } });
    removeLocalNetworking(app);
    expect(read()).toEqual({ CFBundleIdentifier: "com.example.app" });
    write({ CFBundleIdentifier: "com.example.app", NSAppTransportSecurity: { NSAllowsLocalNetworking: true, NSExceptionDomains: { "example.com": { NSIncludesSubdomains: true } } } });
    removeLocalNetworking(app);
    expect(read()).toEqual({ CFBundleIdentifier: "com.example.app", NSAppTransportSecurity: { NSExceptionDomains: { "example.com": { NSIncludesSubdomains: true } } } });
    removeLocalNetworking(app);
    write({ CFBundleIdentifier: "com.example.app" });
    removeLocalNetworking(app);
    expect(read()).toEqual({ CFBundleIdentifier: "com.example.app" });
  } finally { rmSync(app, { recursive: true, force: true }); }
});
