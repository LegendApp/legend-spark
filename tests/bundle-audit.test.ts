import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { auditBundle, noticesFindings, type AuditOptions } from "../scripts/e2e/audit/bundle.ts";
import { parseCheckRegistry } from "../scripts/e2e/format/parser.ts";

const HERMES = Buffer.concat([Buffer.from([0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f]), Buffer.from([96, 0, 0, 0]), Buffer.alloc(64)]);
const PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>so.legend.app</string><key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleInfoDictionaryVersion</key><string>6.0</string><key>CFBundleName</key><string>App</string>
<key>CFBundleExecutable</key><string>App</string><key>CFBundleShortVersionString</key><string>1.2.3</string>
<key>CFBundleVersion</key><string>42</string><key>LSMinimumSystemVersion</key><string>14.0</string>
<key>NSPrincipalClass</key><string>NSApplication</string>
</dict></plist>`;
const NOTICES = "Third-party software notices for App\n\n## react-native 0.81.6\nLicense: MIT\nSource: npm\n\nMIT License …\n";

/** A clean macOS app bundle without Mach-O binaries (the binary checks run on real builds), plus `extra` files. */
function bundle(extra: Record<string, string | Buffer> = {}): AuditOptions {
  const dir = mkdtempSync(path.join(tmpdir(), "bundle-audit-")), app = path.join(dir, "App.app"), symbols = path.join(dir, "dSYMs");
  const files: Record<string, string | Buffer> = {
    "Contents/Info.plist": PLIST, "Contents/MacOS/App": "#!/bin/sh\n", "Contents/Resources/main.jsbundle": HERMES,
    "Contents/Resources/ThirdPartyNotices.txt": NOTICES, ...extra,
  };
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(app, file)), { recursive: true });
    writeFileSync(path.join(app, file), content);
  }
  mkdirSync(symbols);
  return { app, platform: "macos", appId: "so.legend.app", sizeBudgetMB: 1, symbols };
}
const byCheck = (options: AuditOptions) => Object.fromEntries(auditBundle(options).map(result => [result.check, result]));

describe("bundle audit", () => {
  test("a clean bundle passes every check", () => {
    const results = byCheck(bundle());
    // Info.plist is read with plutil, which only macOS has.
    for (const [id, result] of Object.entries(results)) if (id !== "DIST-HYG-08" || process.platform === "darwin") expect([id, result.status, result.details]).toEqual([id, "passed", expect.any(Array)]);
    expect(results["DIST-HYG-01"]!.details[0]).toMatch(/^Contents\/Resources\/main\.jsbundle: Hermes bytecode version 96, /);
  });

  test("finds plain JavaScript, source maps, leftovers, machine paths, credentials, size and notices problems", () => {
    const results = byCheck({
      ...bundle({
        "Contents/Resources/extra.js": "console.log(1)\n//# sourceMappingURL=extra.js.map\n",
        "Contents/Resources/extra.js.map": "{}",
        "Contents/Resources/.DS_Store": "x",
        "Contents/Resources/node_modules/a/index.js": HERMES,
        "Contents/Resources/config.json": '{"root":"/Users/alice/dev/app/src","key":"AKIAABCDEFGHIJKLMNOP"}',
        "Contents/Resources/ThirdPartyNotices.txt": "## left-pad 1.0.0\nSource: npm\n",
      }),
      sizeBudgetMB: 0.0001,
    });
    expect(results["DIST-HYG-01"]!.details).toEqual(["Contents/Resources/extra.js is not Hermes bytecode"]);
    expect(results["DIST-HYG-02"]!.details).toEqual(["Contents/Resources/extra.js.map: source map file", "Contents/Resources/extra.js: references a source map (sourceMappingURL)"]);
    expect(results["DIST-HYG-03"]!.details).toEqual(["Contents/Resources/.DS_Store: Finder metadata", "Contents/Resources/extra.js.map: source map", "Contents/Resources/node_modules: node_modules"]);
    expect(results["DIST-HYG-06"]!.details).toEqual(["Contents/Resources/config.json: 1 build-machine path(s), such as /Users/alice/dev/app/src"]);
    expect(results["DIST-HYG-07"]!.details).toEqual(["Contents/Resources/config.json: 1 AWS access key ID(s), starting AKIAABCD…"]);
    expect(results["DIST-HYG-09"]!.details[0]).toMatch(/^0\.0 MB is over the 0\.0001 MB budget; largest: /);
    expect(results["DIST-HYG-10"]!.details).toEqual(["left-pad 1.0.0: no license"]);
  });

  test.skipIf(process.platform !== "darwin")("Info.plist keeps App Transport Security on: no arbitrary loads, localhost exception or local networking", () => {
    const ats = "<key>NSAppTransportSecurity</key><dict><key>NSAllowsArbitraryLoads</key><true/><key>NSAllowsLocalNetworking</key><true/><key>NSExceptionDomains</key><dict><key>localhost</key><dict/></dict></dict>";
    const results = byCheck(bundle({ "Contents/Info.plist": PLIST.replace("</dict></plist>", `${ats}\n</dict></plist>`) }));
    expect(results["DIST-HYG-08"]).toMatchObject({ status: "failed", details: [
      "NSAppTransportSecurity.NSAllowsArbitraryLoads is true: release builds keep App Transport Security on",
      "NSAppTransportSecurity.NSAllowsLocalNetworking is set: it is for the development server, and spark build removes it from release builds",
      "NSAppTransportSecurity exempts localhost: that is for a development server",
    ] });
  });

  test("fails closed without a size budget, a symbols folder or notices", () => {
    const options = bundle();
    writeFileSync(path.join(options.app, "Contents/Resources/ThirdPartyNotices.txt"), "");
    const results = byCheck({ ...options, sizeBudgetMB: undefined, symbols: undefined });
    expect(results["DIST-HYG-05"]!.details).toEqual(["gate.yaml sets no build.macos.symbols folder"]);
    expect(results["DIST-HYG-09"]!.details[0]).toMatch(/^gate\.yaml sets no build\.macos\.sizeBudgetMB/);
    expect(results["DIST-HYG-10"]!.details).toEqual(["lists no packages"]);
  });

  test("Windows runs the portable checks and reports the rest unsupported", () => {
    const results = auditBundle({ ...bundle(), platform: "windows" });
    expect(results.filter(result => result.status === "unsupported").map(result => result.check)).toEqual(["DIST-HYG-01", "DIST-HYG-04", "DIST-HYG-05", "DIST-HYG-08", "DIST-HYG-10"]);
    expect(results.filter(result => result.status === "passed").map(result => result.check)).toEqual(["DIST-HYG-02", "DIST-HYG-03", "DIST-HYG-06", "DIST-HYG-07", "DIST-HYG-09"]);
  });

  test("notices must cover every embedded framework", () => {
    expect(noticesFindings(NOTICES + "\n## hermes-engine\nLicense: MIT\n", ["Contents/Frameworks/hermes.framework/Versions/A/hermes", "Contents/Frameworks/Sparkle.framework/Versions/B/Sparkle"]).findings)
      .toEqual(["the embedded Sparkle.framework is not in the notices"]);
  });

  test("the packaging-distribution registry lists exactly the bundle audit's checks", () => {
    const registry = parseCheckRegistry(readFileSync("e2e/checks/packaging-distribution.yaml", "utf8"), "packaging-distribution.yaml");
    const audited = Object.entries(registry.checks).filter(([, check]) => check.audit === "bundle").map(([id]) => id);
    expect(audited).toEqual(auditBundle(bundle()).map(result => result.check));
  });
});
