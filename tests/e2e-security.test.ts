import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { toolchainRpathsPodfile } from "../packages/config-plugin/rpaths.cjs";
import { macAppReader, parseMachO, parseSignature, type AppReader, type CodeSignature, type MachOSlice } from "../scripts/e2e/macho.ts";
import { COMMANDS } from "../scripts/e2e/format/commands.ts";
import { Failure } from "../scripts/e2e/runner/backend.ts";
import { BUILD_AUDITS, runFlows } from "../scripts/e2e/runner/executor.ts";
import { assertCodeSigning, assertEntitlements, assertLoadPaths, assertSandboxVariant } from "../scripts/e2e/runner/security.ts";
import { MemoryBackend, VirtualClock } from "./e2e-runner-backend.ts";

type Spec = Partial<Omit<MachOSlice, "arch">> & { signature?: Partial<CodeSignature> };
const MAIN = "Contents/MacOS/Fake";
const temporary = () => realpathSync(mkdtempSync(path.join(tmpdir(), "e2e-security-")));

/** An app of empty files whose Mach-O facts and signatures come from `files`; a missing `filetype` is a dylib. */
function fakeApp(files: Record<string, Spec>, extra: (app: string) => void = () => {}) {
  const app = path.join(temporary(), "Fake.app");
  for (const relative of Object.keys(files)) {
    mkdirSync(path.dirname(path.join(app, relative)), { recursive: true });
    writeFileSync(path.join(app, relative), "");
  }
  extra(app);
  const at = (file: string) => files[path.relative(app, file)]!;
  const reader: AppReader = {
    executable: root => path.join(root, MAIN),
    code: root => Object.keys(files).map(relative => path.join(root, relative)),
    machO: file => [{ arch: "arm64", filetype: 6, dylibs: [], rpaths: [], dyldEnvironment: [], ...at(file), signature: undefined } as MachOSlice],
    signature: file => ({ signed: true, adhoc: false, team: "TEAM123456", flags: ["runtime"], entitlements: {}, ...at(file).signature }),
  };
  return { app, reader };
}

/** A sound app: system and bundled dependencies, a framework that uses the main executable's run paths, and a helper. */
const sound = (overrides: Record<string, Spec> = {}) => fakeApp({
  [MAIN]: {
    filetype: 2, rpaths: ["/usr/lib/swift", "@executable_path/../Frameworks"],
    dylibs: [
      { kind: "load", name: "/System/Library/Frameworks/AppKit.framework/Versions/C/AppKit" },
      { kind: "weak", name: "/usr/lib/swift/libswiftXPC.dylib" },
      { kind: "load", name: "@rpath/Lib.framework/Versions/A/Lib" },
    ],
  },
  "Contents/Frameworks/Lib.framework/Versions/A/Lib": { dylibs: [{ kind: "load", name: "@rpath/libextra.dylib" }, { kind: "load", name: "@loader_path/../../../libextra.dylib" }] },
  "Contents/Frameworks/libextra.dylib": {},
  "Contents/Helpers/Tool": { filetype: 2, dylibs: [{ kind: "load", name: "@executable_path/../Frameworks/libextra.dylib" }] },
  ...overrides,
});

function failure(run: () => void): Failure {
  try { run(); } catch (error) { if (error instanceof Failure) return error; throw error; }
  throw new Error("expected a Failure");
}

describe("assertLoadPaths", () => {
  test("passes bundled, system and inherited run path dependencies", () => {
    const { app, reader } = sound();
    expect(() => assertLoadPaths({ app }, "macos", reader)).not.toThrow();
  });

  test("fails run paths and dependencies outside the bundle, missing weak libraries and dyld variables", () => {
    const { app, reader } = sound({
      [MAIN]: {
        filetype: 2,
        rpaths: ["@executable_path/../Frameworks", "/usr/local/lib", "lib", "@loader_path/../../.."],
        dylibs: [
          { kind: "weak", name: "@rpath/Missing.dylib" },
          { kind: "load", name: "/opt/homebrew/lib/libfoo.dylib" },
          { kind: "load", name: "libbar.dylib" },
        ],
        dyldEnvironment: ["DYLD_INSERT_LIBRARIES=/tmp/inject.dylib"],
      },
    });
    const { kind, message } = failure(() => assertLoadPaths({ app }, "macos", reader));
    expect(kind).toBe("assertion");
    expect(message.split("\n")).toEqual([
      "assertLoadPaths found 7 problems:",
      `  ${MAIN}: LC_DYLD_ENVIRONMENT sets DYLD_INSERT_LIBRARIES=/tmp/inject.dylib`,
      `  ${MAIN}: LC_RPATH /usr/local/lib is outside the bundle and the system library locations`,
      `  ${MAIN}: LC_RPATH lib is relative to the working directory`,
      `  ${MAIN}: LC_RPATH @loader_path/../../.. is outside the bundle and the system library locations`,
      `  ${MAIN}: weak dependency @rpath/Missing.dylib is not in the bundle; a library planted on its search path would load`,
      `  ${MAIN}: dependency /opt/homebrew/lib/libfoo.dylib is outside the bundle and the system library locations`,
      `  ${MAIN}: dependency libbar.dylib is relative to the working directory`,
    ]);
  });

  test("a bundled path that is a symlink out of the bundle does not resolve inside it", () => {
    const outside = path.join(temporary(), "libextra.dylib");
    writeFileSync(outside, "");
    const { app, reader } = fakeApp({
      [MAIN]: { filetype: 2, rpaths: ["@executable_path/../Frameworks"], dylibs: [{ kind: "load", name: "@rpath/libextra.dylib" }] },
    }, root => { mkdirSync(path.join(root, "Contents/Frameworks"), { recursive: true }); symlinkSync(outside, path.join(root, "Contents/Frameworks/libextra.dylib")); });
    expect(failure(() => assertLoadPaths({ app }, "macos", reader)).message).toContain(`${MAIN}: dependency @rpath/libextra.dylib is not in the bundle`);
  });

  test("is typed unsupported on Windows until the Windows backend lands", () => {
    const { kind, message } = failure(() => assertLoadPaths({ app: "C:\\App" }, "windows"));
    expect(kind).toBe("unsupported");
    expect(message).toContain("#51");
  });
});

describe("assertEntitlements", () => {
  test("passes no entitlements, and allowed ones with reasons", () => {
    const plain = sound();
    expect(() => assertEntitlements({ app: plain.app, sandbox: false }, "macos", plain.reader)).not.toThrow();
    const { app, reader } = sound({ [MAIN]: { filetype: 2, signature: { entitlements: { "com.apple.security.device.camera": true } } } });
    expect(() => assertEntitlements({ app, sandbox: false, allow: { "com.apple.security.device.camera": "the camera screen" } }, "macos", reader)).not.toThrow();
  });

  test("fails unlisted entitlements, get-task-allow, stale allow entries and entitlements on libraries", () => {
    const { app, reader } = sound({
      [MAIN]: { filetype: 2, signature: { entitlements: { "com.apple.security.get-task-allow": true, "com.apple.security.cs.disable-library-validation": true } } },
      "Contents/Frameworks/libextra.dylib": { signature: { entitlements: { "com.apple.security.network.client": true } } },
    });
    expect(failure(() => assertEntitlements({ app, sandbox: false, allow: { "com.apple.security.cs.allow-jit": "a JIT" } }, "macos", reader)).message.split("\n")).toEqual([
      "assertEntitlements found 4 problems:",
      `  ${MAIN}: com.apple.security.get-task-allow lets any process debug it; a release build never carries it`,
      `  ${MAIN}: com.apple.security.cs.disable-library-validation is not in allow (a hardened runtime exception: it loads libraries signed by anyone)`,
      "  Contents/Frameworks/libextra.dylib: a library is signed with entitlements (com.apple.security.network.client); entitlements belong on executables",
      "  allow lists com.apple.security.cs.allow-jit, which no process carries; remove it",
    ]);
  });

  test("an allowed entitlement needs a reason", () => {
    const { app, reader } = sound();
    expect(failure(() => assertEntitlements({ app, sandbox: false, allow: { "com.apple.security.cs.allow-jit": " " } }, "macos", reader)).kind).toBe("invalid");
  });

  test("the direct build sandboxes nothing; the sandboxed variant sandboxes every process", () => {
    const sandboxed = { entitlements: { "com.apple.security.app-sandbox": true } };
    const direct = sound({ "Contents/Helpers/Tool": { filetype: 2, signature: sandboxed } });
    expect(failure(() => assertEntitlements({ app: direct.app, sandbox: false }, "macos", direct.reader)).message).toContain("Contents/Helpers/Tool: sandboxed (com.apple.security.app-sandbox) in a build that is not the sandbox variant");
    const partly = sound({ [MAIN]: { filetype: 2, signature: sandboxed } });
    expect(failure(() => assertEntitlements({ app: partly.app, sandbox: true }, "macos", partly.reader)).message).toContain("Contents/Helpers/Tool: not sandboxed (com.apple.security.app-sandbox)");
    const full = sound({ [MAIN]: { filetype: 2, signature: sandboxed }, "Contents/Helpers/Tool": { filetype: 2, signature: sandboxed } });
    expect(() => assertEntitlements({ app: full.app, sandbox: true }, "macos", full.reader)).not.toThrow();
  });
});

// It reads Info.plist with plutil, which only macOS has.
describe.skipIf(process.platform !== "darwin")("assertSandboxVariant", () => {
  const info = (keys: Record<string, string>) => (app: string) => {
    writeFileSync(path.join(app, "Contents/Info.plist"), JSON.stringify({ CFBundleExecutable: "Fake", ...keys }));
    execFileSync("plutil", ["-convert", "xml1", path.join(app, "Contents/Info.plist")]);
  };
  const SANDBOX = { "com.apple.security.app-sandbox": true }, INHERIT = { ...SANDBOX, "com.apple.security.inherit": true };
  test("passes a sandboxed main executable, helpers with only app-sandbox and inherit, and no Sparkle, its Info.plist keys or launch daemons", () => {
    const { app, reader } = sound({
      [MAIN]: { filetype: 2, signature: { entitlements: { ...SANDBOX, "com.apple.security.print": true } } },
      "Contents/Helpers/Tool": { filetype: 2, signature: { entitlements: INHERIT } },
    });
    info({})(app);
    expect(() => assertSandboxVariant({ app }, "macos", reader)).not.toThrow();
  });
  test("fails an unsandboxed or inheriting main executable and helpers with other entitlements", () => {
    const { app, reader } = sound({
      [MAIN]: { filetype: 2, signature: { entitlements: INHERIT } },
      "Contents/Helpers/Tool": { filetype: 2, signature: { entitlements: { ...INHERIT, "com.apple.security.network.client": true } } },
    });
    info({})(app);
    expect(failure(() => assertSandboxVariant({ app }, "macos", reader)).message).toBe([
      "assertSandboxVariant found 2 problems:",
      `  ${MAIN}: the main executable must carry com.apple.security.app-sandbox and not com.apple.security.inherit (it has com.apple.security.app-sandbox, com.apple.security.inherit)`,
      "  Contents/Helpers/Tool: a helper process must carry exactly com.apple.security.app-sandbox and com.apple.security.inherit (it has com.apple.security.app-sandbox, com.apple.security.inherit, com.apple.security.network.client)",
    ].join("\n"));
  });
  test("fails Sparkle's framework, code linking it, SU* keys and launch daemons", () => {
    const { app, reader } = fakeApp({
      [MAIN]: { filetype: 2, dylibs: [{ kind: "load", name: "@rpath/Sparkle.framework/Versions/B/Sparkle" }], signature: { entitlements: SANDBOX } },
      "Contents/Frameworks/Sparkle.framework/Versions/B/Sparkle": {},
      "Contents/Frameworks/Sparkle.framework/Versions/B/Autoupdate": { filetype: 2, signature: { entitlements: INHERIT } },
    }, app => {
      info({ SUFeedURL: "https://example.com/appcast.xml", SUPublicEDKey: "key", SupportURL: "not Sparkle" })(app);
      mkdirSync(path.join(app, "Contents/Library/LaunchDaemons"), { recursive: true });
      writeFileSync(path.join(app, "Contents/Library/LaunchDaemons/so.legend.app.tool.plist"), "");
    });
    expect(failure(() => assertSandboxVariant({ app }, "macos", reader)).message).toBe([
      "assertSandboxVariant found 6 problems:",
      `  ${MAIN}: links @rpath/Sparkle.framework/Versions/B/Sparkle; the App Store updates the sandboxed variant`,
      "  Contents/Frameworks/Sparkle.framework/Versions/B/Sparkle: Sparkle code; the App Store updates the sandboxed variant",
      "  Contents/Frameworks/Sparkle.framework/Versions/B/Autoupdate: Sparkle code; the App Store updates the sandboxed variant",
      "  Info.plist: SUFeedURL configures Sparkle",
      "  Info.plist: SUPublicEDKey configures Sparkle",
      "  Contents/Library/LaunchDaemons: so.legend.app.tool.plist; a sandboxed app cannot install a launch daemon (privileged helper)",
    ].join("\n"));
  });
});

describe("assertCodeSigning", () => {
  test("passes one team, the hardened runtime on every process and library validation", () => {
    const { app, reader } = sound({ "Contents/Frameworks/libextra.dylib": { signature: { flags: [] } } });
    expect(() => assertCodeSigning({ app }, "macos", reader)).not.toThrow();
  });

  test("fails ad-hoc, foreign-team and unsigned code, a process without the hardened runtime and disabled library validation", () => {
    const { app, reader } = sound({
      "Contents/Frameworks/libextra.dylib": { signature: { team: "OTHERTEAM1" } },
      "Contents/Frameworks/Lib.framework/Versions/A/Lib": { signature: { signed: false, team: undefined } },
      "Contents/Helpers/Tool": { filetype: 2, signature: { flags: [], entitlements: { "com.apple.security.cs.disable-library-validation": true } } },
    });
    expect(failure(() => assertCodeSigning({ app }, "macos", reader)).message.split("\n")).toEqual([
      "assertCodeSigning found 4 problems:",
      "  Contents/Frameworks/Lib.framework/Versions/A/Lib: not signed",
      "  Contents/Frameworks/libextra.dylib: signed by team OTHERTEAM1, not TEAM123456; library validation refuses it",
      "  Contents/Helpers/Tool: the hardened runtime is not enabled (flags: none)",
      "  Contents/Helpers/Tool: com.apple.security.cs.disable-library-validation turns library validation off",
    ]);
    const adhoc = sound({ [MAIN]: { filetype: 2, signature: { adhoc: true, team: undefined, flags: ["adhoc"] } } });
    expect(failure(() => assertCodeSigning({ app: adhoc.app }, "macos", adhoc.reader)).message).toContain(`${MAIN}: signed ad-hoc; the hardened runtime and library validation need a Developer ID signature`);
  });
});

describe("Mach-O and signature parsing", () => {
  const LC_RPATH = 0x8000001c;
  function thin(commands: Array<[number, string]>, filetype = 2) {
    const loads = commands.map(([cmd, text]) => {
      const offset = cmd === LC_RPATH || cmd === 0x27 ? 12 : 24, size = Math.ceil((offset + text.length + 1) / 8) * 8, buffer = Buffer.alloc(size);
      buffer.writeUInt32LE(cmd, 0); buffer.writeUInt32LE(size, 4); buffer.writeUInt32LE(offset, 8); buffer.write(text, offset);
      return buffer;
    });
    const header = Buffer.alloc(32);
    header.writeUInt32LE(0xfeedfacf, 0); header.writeUInt32LE(0x0100000c, 4); header.writeUInt32LE(filetype, 12);
    header.writeUInt32LE(loads.length, 16); header.writeUInt32LE(loads.reduce((sum, load) => sum + load.length, 0), 20);
    return Buffer.concat([header, ...loads]);
  }
  const reading = (buffer: Buffer) => (offset: number, length: number) => buffer.subarray(offset, offset + length);

  test("reads dylib kinds, run paths and dyld environment from thin and universal files", () => {
    const slice = thin([[0xc, "/usr/lib/libSystem.B.dylib"], [0x80000018, "@rpath/Weak.dylib"], [LC_RPATH, "@executable_path/../Frameworks"], [0x27, "DYLD_X=1"], [0xd, "@rpath/Self.dylib"]]);
    const expected = { arch: "arm64", filetype: 2, dylibs: [{ kind: "load", name: "/usr/lib/libSystem.B.dylib" }, { kind: "weak", name: "@rpath/Weak.dylib" }], rpaths: ["@executable_path/../Frameworks"], dyldEnvironment: ["DYLD_X=1"] };
    expect(parseMachO(reading(slice))).toEqual([expected]);
    const fat = Buffer.alloc(64);
    fat.writeUInt32BE(0xcafebabe, 0); fat.writeUInt32BE(1, 4); fat.writeUInt32BE(0x0100000c, 8); fat.writeUInt32BE(64, 16); fat.writeUInt32BE(slice.length, 20);
    expect(parseMachO(reading(Buffer.concat([fat, slice])))).toEqual([expected]);
    expect(parseMachO(reading(Buffer.from("#!/bin/sh\n")))).toEqual([]);
  });

  test("reads codesign's details", () => {
    expect(parseSignature("x: code object is not signed at all\n", {})).toEqual({ signed: false, adhoc: false, flags: [], entitlements: {} });
    expect(parseSignature("CodeDirectory v=20400 size=454 flags=0x2(adhoc) hashes=3+7\nSignature=adhoc\nTeamIdentifier=not set\n", {})).toEqual({ signed: true, adhoc: true, team: undefined, flags: ["adhoc"], entitlements: {} });
    expect(parseSignature("CodeDirectory v=20500 size=9 flags=0x10000(runtime) hashes=1+7\nAuthority=Developer ID Application: Example (ABCDE12345)\nTeamIdentifier=ABCDE12345\n", { a: true }))
      .toEqual({ signed: true, adhoc: false, team: "ABCDE12345", flags: ["runtime"], entitlements: { a: true } });
  });
});

describe("in flows", () => {
  test("every runner command has an implementation", () => {
    expect(Object.keys(COMMANDS).filter(name => COMMANDS[name]!.runner).sort()).toEqual(Object.keys(BUILD_AUDITS).sort());
  });

  test("a flow of runner commands alone starts no backend, so it never opens the app", async () => {
    const dir = temporary(), file = path.join(dir, "flows/security/audit.yaml");
    mkdirSync(path.dirname(file), { recursive: true });
    const header = "appId: so.legend.kitchensink\nname: Audit\nintent: Audits the build.\nchecks: [SEC-DYLD-01]\n---\n";
    writeFileSync(file, `${header}- assertLoadPaths: "\${APP_PATH}"\n`);
    const backend = new MemoryBackend(new VirtualClock(), { platform: "windows" });
    const [result] = await runFlows([file], { backends: [backend], runDir: path.join(dir, "run"), app: "C:\\App", clock: backend.clock });
    expect(result!.failure).toMatchObject({ kind: "unsupported", command: "assertLoadPaths" });
    expect(backend.log).toEqual([]);
    writeFileSync(file, `${header}- launchApp\n- assertLoadPaths: "\${APP_PATH}"\n`);
    const [mixed] = await runFlows([file], { backends: [backend], runDir: path.join(dir, "run2"), app: "C:\\App", clock: backend.clock });
    expect(mixed!.status).toBe("failed");
    expect(backend.log[0]).toBe("start");
  });
});

test("the Podfile hook drops toolchain run paths after react_native_post_install, once", () => {
  const podfile = "target 'App' do\n  post_install do |installer|\n    react_native_post_install(installer, \"../rn\")\n  end\nend\n";
  const hooked = toolchainRpathsPodfile(podfile);
  expect(hooked).toContain("react_native_post_install(installer, \"../rn\")\n\n    # spark: no toolchain rpaths\n");
  expect(hooked).toContain("reject { |path| path.include?('TOOLCHAIN_DIR') }");
  expect(toolchainRpathsPodfile(hooked)).toBe(hooked);
  expect(() => toolchainRpathsPodfile("target 'App' do\nend\n")).toThrow("react_native_post_install");
});

// Real binaries, linked and signed ad-hoc by the macOS tools, read through macAppReader.
test.runIf(process.platform === "darwin")("audits a real ad-hoc signed app", () => {
  const dir = temporary(), app = path.join(dir, "Real.app"), frameworks = path.join(app, "Contents/Frameworks"), macos = path.join(app, "Contents/MacOS");
  mkdirSync(frameworks, { recursive: true });
  mkdirSync(macos, { recursive: true });
  writeFileSync(path.join(app, "Contents/Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>CFBundleExecutable</key><string>Real</string><key>CFBundleIdentifier</key><string>so.legend.spark.tests.real</string></dict></plist>\n`);
  writeFileSync(path.join(dir, "lib.c"), "int answer(void) { return 42; }\n");
  writeFileSync(path.join(dir, "main.c"), "int answer(void);\nint main(void) { return answer() == 42 ? 0 : 1; }\n");
  const run = (command: string, args: string[]) => execFileSync(command, args, { cwd: dir, stdio: "pipe" });
  run("cc", ["-dynamiclib", "-o", path.join(frameworks, "libanswer.dylib"), "-install_name", "@rpath/libanswer.dylib", "lib.c"]);
  run("cc", ["-dynamiclib", "-o", "libmissing.dylib", "-install_name", "@rpath/libmissing.dylib", "lib.c"]);
  const link = (extra: string[]) => run("cc", ["-o", path.join(macos, "Real"), "main.c", `-L${frameworks}`, "-lanswer", "-Wl,-rpath,@executable_path/../Frameworks", ...extra]);
  const sign = (entitlements?: string) => {
    run("codesign", ["--force", "--sign", "-", path.join(frameworks, "libanswer.dylib")]);
    run("codesign", ["--force", "--sign", "-", ...(entitlements ? ["--entitlements", entitlements] : []), app]);
  };

  link([]);
  sign();
  expect(() => assertLoadPaths({ app }, "macos")).not.toThrow();
  expect(() => assertEntitlements({ app, sandbox: false }, "macos")).not.toThrow();
  expect(failure(() => assertCodeSigning({ app }, "macos")).message).toContain("Contents/MacOS/Real: signed ad-hoc");
  expect(macAppReader.signature(path.join(macos, "Real"))).toMatchObject({ signed: true, adhoc: true, team: undefined });

  link(["-Wl,-rpath,/usr/local/lib", "-L.", "-weak-lmissing"]);
  const plist = path.join(dir, "debug.plist");
  writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>com.apple.security.get-task-allow</key><true/></dict></plist>\n`);
  sign(plist);
  expect(failure(() => assertLoadPaths({ app }, "macos")).message.split("\n").slice(1)).toEqual([
    "  Contents/MacOS/Real: LC_RPATH /usr/local/lib is outside the bundle and the system library locations",
    "  Contents/MacOS/Real: weak dependency @rpath/libmissing.dylib is not in the bundle; a library planted on its search path would load",
  ]);
  expect(failure(() => assertEntitlements({ app, sandbox: false }, "macos")).message).toContain("Contents/MacOS/Real: com.apple.security.get-task-allow lets any process debug it");
}, 60_000); // Compiles, signs and inspects real binaries: well under a second locally, much slower on a loaded CI runner.
