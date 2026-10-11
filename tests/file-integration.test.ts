import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, expect, test, vi } from "vitest";

const calls: { method: string; args: any }[] = [];
const handlers = new Map<string, (args: any) => unknown>();
const platform = { OS: "macos" };
let installed = true;
const native = { binaryCall: async (method: string, json: string, buffer?: ArrayBuffer, offset?: number, length?: number) => {
  const args = JSON.parse(json);
  if (buffer) args.bytes = new Uint8Array(buffer, offset, length).slice();
  calls.push({ method, args });
  const handler = handlers.get(method);
  return handler ? handler(args) : null;
} };
vi.doMock("react-native", () => ({ Platform: platform, TurboModuleRegistry: { get: () => installed ? native : null }, NativeEventEmitter: class {} }));
const files = await import("../packages/file-system/src/index.ts");
const { SparkError } = await import("../packages/desktop-app/src/contracts/index.ts");
const nativeError = (code: string) => Object.assign(new Error(code), { code });
const pngBytes = () => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]).buffer;
beforeEach(() => { platform.OS = "macos"; installed = true; calls.length = 0; handlers.clear(); });

const plist = (entries: Record<string, string | boolean>) => `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>${Object.entries(entries)
  .map(([key, value]) => `<key>${key}</key>${typeof value === "boolean" ? `<${value}/>` : `<string>${value}</string>`}`).join("")}</dict></plist>`;
test.skipIf(process.platform !== "darwin")("native bookmarks, FDA, open-with, images, xattrs, quarantine, space and coordination", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-file-integration-"));
  try {
    const root = path.resolve(import.meta.dirname, "..");
    const output = path.join(directory, "test");
    // A sandboxed process needs a bundle identifier; it names the reused container ~/Library/Containers/<id>.
    writeFileSync(path.join(directory, "Info.plist"), plist({ CFBundleIdentifier: "so.legend.spark.tests.file-integration", CFBundleName: "file-integration" }));
    execFileSync("clang++", ["-std=c++17", "-fobjc-arc", "-fblocks", "-framework", "AppKit", "-framework", "Quartz", "-framework", "QuickLookThumbnailing", "-framework", "UniformTypeIdentifiers", "-framework", "CoreServices", "-framework", "Security",
      "-I", path.join(root, "packages/file-system/macos"), "-I", path.join(root, "packages/desktop-app/macos"), "-sectcreate", "__TEXT", "__info_plist", path.join(directory, "Info.plist"),
      path.join(root, "packages/file-system/macos/SparkFileIntegration.mm"), path.join(root, "tests/file-integration.native.mm"), "-o", output]);
    expect(execFileSync(output, [directory], { encoding: "utf8" })).toContain("File integration tests passed");
    for (const [mode, entitlements] of [
      ["--sandboxed", { "com.apple.security.app-sandbox": true, "com.apple.security.files.bookmarks.app-scope": true }],
      ["--sandboxed-without-bookmarks", { "com.apple.security.app-sandbox": true }],
    ] as const) {
      const signed = `${output}${mode}`, plistPath = `${signed}.entitlements`;
      writeFileSync(plistPath, plist(entitlements));
      execFileSync("cp", [output, signed]);
      execFileSync("codesign", ["--force", "--sign", "-", "--entitlements", plistPath, signed], { stdio: "pipe" });
      expect(execFileSync(signed, [mode], { encoding: "utf8" }), mode).toContain("Sandboxed file integration tests passed");
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 60000);

const features = {
  getBookmarkAvailability: ["macos"], getFullDiskAccessAvailability: ["macos"], getFileCoordinationAvailability: ["macos"],
  getOpenWithAvailability: ["macos", "windows"], getFileIconAvailability: ["macos", "windows"], getThumbnailAvailability: ["macos", "windows"],
  getQuickLookAvailability: ["macos"], getExtendedAttributeAvailability: ["macos"], getQuarantineAvailability: ["macos", "windows"],
  getDiskSpaceAvailability: ["macos", "windows"],
} as const;
test("availability reports platform support and a missing module without loading native code", () => {
  for (const os of ["macos", "windows", "ios", "web"]) {
    platform.OS = os;
    for (const [name, supported] of Object.entries(features)) {
      const expected = (supported as readonly string[]).includes(os) ? { available: true } : { available: false, reason: "unsupported-platform" };
      expect((files as any)[name](), `${name} on ${os}`).toEqual(expected);
    }
  }
});
test("a missing native module is reported by availability and rejects typed", async () => {
  vi.resetModules(); installed = false;
  const missing = await import("../packages/file-system/src/index.ts");
  for (const name of Object.keys(features)) expect((missing as any)[name]()).toEqual({ available: false, reason: "missing-module" });
  await expect(missing.getDiskSpace("/a")).rejects.toMatchObject({ code: "E_MODULE_UNAVAILABLE" });
  await expect(missing.readText("/a", { coordinated: true })).rejects.toMatchObject({ code: "E_MODULE_UNAVAILABLE" });
});

test("unsupported features reject with typed SparkError before native dispatch", async () => {
  platform.OS = "windows";
  const attempts: [string, () => Promise<unknown>][] = [
    ["createBookmark", () => files.createBookmark("C:\\a")], ["accessBookmark", () => files.accessBookmark(new Uint8Array([1]))],
    ["getFullDiskAccessStatus", () => files.getFullDiskAccessStatus()], ["openFullDiskAccessSettings", () => files.openFullDiskAccessSettings()],
    ["withBookmarkAccess", () => files.withBookmarkAccess(new Uint8Array([1]), () => {})],
    ["showQuickLook", () => files.showQuickLook(["C:\\a"])], ["listExtendedAttributes", () => files.listExtendedAttributes("C:\\a")],
    ["getExtendedAttribute", () => files.getExtendedAttribute("C:\\a", "n")], ["setExtendedAttribute", () => files.setExtendedAttribute("C:\\a", "n", new Uint8Array())],
    ["removeExtendedAttribute", () => files.removeExtendedAttribute("C:\\a", "n")], ["readText coordinated", () => files.readText("C:\\a", { coordinated: true })],
    ["move coordinated", () => files.move("C:\\a", "C:\\b", { coordinated: true })],
  ];
  for (const [name, attempt] of attempts) {
    const error: any = await attempt().catch(error => error);
    expect(error, name).toBeInstanceOf(SparkError); expect(error.code, name).toBe("E_UNSUPPORTED_PLATFORM");
  }
  expect(calls).toEqual([]);
  platform.OS = "ios";
  await expect(files.getDiskSpace("/a")).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
});

test("bookmarks persist as bytes and access closes once", async () => {
  handlers.set("createBookmark", () => new Uint8Array([9, 8, 7]).buffer);
  const bookmark = await files.createBookmark("/Users/me/Projects", { readOnly: true });
  expect(bookmark).toEqual(new Uint8Array([9, 8, 7])); expect(calls[0].args).toEqual({ path: "/Users/me/Projects", readOnly: true });
  handlers.set("accessBookmark", args => ({ id: "access-1", path: "/Users/me/Moved", stale: args.bytes.length === 3 }));
  const access = await files.accessBookmark(bookmark);
  expect(access).toMatchObject({ path: "/Users/me/Moved", stale: true });
  await Promise.all([access.close(), access.close()]); await access.close();
  expect(calls.filter(call => call.method === "closeBookmark")).toEqual([{ method: "closeBookmark", args: { id: "access-1" } }]);
  handlers.set("accessBookmark", () => { throw nativeError("E_INVALID_DATA"); });
  await expect(files.accessBookmark(new Uint8Array([1]))).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  await expect(files.accessBookmark(new Uint8Array())).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(files.createBookmark("/a", { readonly: true } as never)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  handlers.set("accessBookmark", () => ({ id: "x", path: "relative", stale: false }));
  await expect(files.accessBookmark(new Uint8Array([1]))).rejects.toMatchObject({ code: "E_INVALID_DATA" });
});

test("withBookmarkAccess bounds access to the callback", async () => {
  let next = 0;
  handlers.set("accessBookmark", () => ({ id: `access-${++next}`, path: "/Users/me/Projects", stale: false }));
  const closed = () => calls.filter(call => call.method === "closeBookmark").map(call => call.args.id);
  expect(await files.withBookmarkAccess(new Uint8Array([1]), access => `${access.path} open`)).toBe("/Users/me/Projects open");
  expect(closed()).toEqual(["access-1"]);
  const failure = new Error("callback failed");
  await expect(files.withBookmarkAccess(new Uint8Array([1]), async () => { throw failure; })).rejects.toBe(failure);
  expect(closed()).toEqual(["access-1", "access-2"]);
  handlers.set("closeBookmark", () => { throw nativeError("E_NATIVE"); });
  const both: any = await files.withBookmarkAccess(new Uint8Array([1]), () => { throw failure; }).catch(error => error);
  expect(both).toBeInstanceOf(files.FileCleanupError); expect(both.operationError).toBe(failure); expect(both.cleanupError).toMatchObject({ code: "E_NATIVE" });
  handlers.delete("closeBookmark"); await both.retryCleanup();
  expect(closed()).toEqual(["access-1", "access-2", "access-3", "access-3"]);
  await expect(files.withBookmarkAccess(new Uint8Array([1]), "nope" as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
});

test("Full Disk Access status is granted, denied or indeterminate (sandboxed), never guessed", async () => {
  handlers.set("fullDiskAccess", () => "denied"); expect(await files.getFullDiskAccessStatus()).toBe("denied");
  handlers.set("fullDiskAccess", () => "indeterminate"); expect(await files.getFullDiskAccessStatus()).toBe("indeterminate");
  handlers.set("fullDiskAccess", () => "unknown"); await expect(files.getFullDiskAccessStatus()).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  handlers.set("fullDiskAccess", () => { throw nativeError("E_UNAVAILABLE"); }); await expect(files.getFullDiskAccessStatus()).rejects.toMatchObject({ code: "E_UNAVAILABLE" });
  await files.openFullDiskAccessSettings(); expect(calls.at(-1)?.method).toBe("openFullDiskAccessSettings");
});

test("open-with lists one default and opens with an absolute application path", async () => {
  const apps = [{ name: "TextEdit", path: "/System/Applications/TextEdit.app", isDefault: true }, { name: "Xcode", path: "/Applications/Xcode.app", isDefault: false }];
  handlers.set("applications", () => apps); expect(await files.getApplicationsForFile("/a.txt")).toEqual(apps);
  handlers.set("applications", () => apps.map(app => ({ ...app, isDefault: true }))); await expect(files.getApplicationsForFile("/a.txt")).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  await files.openWithApplication("/a.txt", "/System/Applications/TextEdit.app");
  expect(calls.at(-1)).toEqual({ method: "openWith", args: { path: "/a.txt", application: "/System/Applications/TextEdit.app" } });
  await expect(files.openWithApplication("/a.txt", "TextEdit")).rejects.toThrow("absolute");
  await expect(files.openWithApplication("/a.txt", "")).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
});

test("icons and thumbnails return PNG bytes and validate size", async () => {
  handlers.set("icon", () => pngBytes()); handlers.set("thumbnail", () => pngBytes());
  expect((await files.getFileIcon("/a", { size: 64 }))[0]).toBe(137);
  expect((await files.getThumbnail("/a", { size: 256 })).length).toBe(9);
  for (const size of [0, 1.5, 1025, Number.NaN]) await expect(files.getFileIcon("/a", { size })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(files.getThumbnail("/a", { size: 32, scale: 2 } as never)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  handlers.set("icon", () => new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]).buffer); await expect(files.getFileIcon("/a", { size: 64 })).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  handlers.set("thumbnail", () => { throw nativeError("E_UNAVAILABLE"); }); await expect(files.getThumbnail("/a", { size: 64 })).rejects.toMatchObject({ code: "E_UNAVAILABLE" });
  platform.OS = "windows"; handlers.set("icon", () => pngBytes()); handlers.set("thumbnail", () => pngBytes());
  expect((await files.getFileIcon("C:\\a.txt", { size: 32 }))[0]).toBe(137);
  expect(calls.at(-1)).toEqual({ method: "icon", args: { path: "C:\\a.txt", size: 32 } });
  await files.getThumbnail("C:\\a.png", { size: 96 }); expect(calls.at(-1)).toEqual({ method: "thumbnail", args: { path: "C:\\a.png", size: 96 } });
  platform.OS = "macos";
  await files.showQuickLook(["/a", "file:///b%20c"]); expect(calls.at(-1)).toEqual({ method: "quickLook", args: { paths: ["/a", "/b c"] } });
  await expect(files.showQuickLook([])).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
});

test("extended attributes round trip bytes and absence is explicit", async () => {
  handlers.set("listXattrs", () => ["com.apple.quarantine", "so.legend.tag"]); expect(await files.listExtendedAttributes("/a")).toEqual(["com.apple.quarantine", "so.legend.tag"]);
  handlers.set("getXattr", () => null); expect(await files.getExtendedAttribute("/a", "so.legend.tag")).toBeNull();
  handlers.set("getXattr", () => new Uint8Array([0, 255]).buffer); expect(await files.getExtendedAttribute("/a", "so.legend.tag")).toEqual(new Uint8Array([0, 255]));
  await files.setExtendedAttribute("/a", "so.legend.tag", new Uint8Array([1, 2]));
  expect(calls.at(-1)).toEqual({ method: "setXattr", args: { path: "/a", name: "so.legend.tag", bytes: new Uint8Array([1, 2]) } });
  await files.removeExtendedAttribute("/a", "so.legend.tag");
  await expect(files.getExtendedAttribute("/a", "")).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(files.setExtendedAttribute("/a", "n", "text" as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  handlers.set("getXattr", () => { throw nativeError("E_NOT_FOUND"); }); await expect(files.getExtendedAttribute("/missing", "n")).rejects.toMatchObject({ code: "E_NOT_FOUND" });
});

test("quarantine accepts only fields the platform records", async () => {
  handlers.set("getQuarantine", () => null); expect(await files.getQuarantine("/a")).toBeNull();
  handlers.set("getQuarantine", () => ({ agentName: "Safari", timestamp: 1700000000000 })); expect(await files.getQuarantine("/a")).toEqual({ agentName: "Safari", timestamp: 1700000000000 });
  handlers.set("getQuarantine", () => ({ agentName: 1 })); await expect(files.getQuarantine("/a")).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  await files.setQuarantine("/a", { agentName: "Spark", timestamp: 1 }); expect(calls.at(-1)).toEqual({ method: "setQuarantine", args: { path: "/a", info: { agentName: "Spark", timestamp: 1 } } });
  await expect(files.setQuarantine("/a", { dataURL: "https://example.com/a" })).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  await expect(files.setQuarantine("/a", { flags: 1 } as never)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  platform.OS = "windows";
  await files.setQuarantine("C:\\a", { dataURL: "https://example.com/a", originURL: "https://example.com" });
  expect(calls.at(-1)).toEqual({ method: "setQuarantine", args: { path: "C:\\a", info: { dataURL: "https://example.com/a", originURL: "https://example.com" } } });
  await expect(files.setQuarantine("C:\\a", { agentName: "Spark" })).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  await expect(files.setQuarantine("C:\\a", { dataURL: "relative" })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await files.clearQuarantine("C:\\a"); expect(calls.at(-1)?.method).toBe("clearQuarantine");
});

test("disk space validates byte counts", async () => {
  handlers.set("diskSpace", () => ({ totalBytes: 1000, availableBytes: 400, macos: { importantUsageBytes: 600 } }));
  expect(await files.getDiskSpace("/")).toEqual({ totalBytes: 1000, availableBytes: 400, macos: { importantUsageBytes: 600 } });
  handlers.set("diskSpace", () => ({ totalBytes: -1, availableBytes: 0 })); await expect(files.getDiskSpace("/")).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  await expect(files.getDiskSpace("relative")).rejects.toThrow("absolute");
});

test("coordination is an explicit per-operation option", async () => {
  handlers.set("readText", () => "text"); handlers.set("readBytes", () => new ArrayBuffer(1)); handlers.set("remove", () => true);
  await files.readText("/a", { coordinated: true }); await files.readBytes("/a", { coordinated: true });
  await files.writeText("/a", "t", { coordinated: true }); await files.writeBytes("/a", new Uint8Array([1]), { coordinated: true });
  await files.copy("/a", "/b", { coordinated: true, overwrite: true }); await files.move("/b", "/c", { coordinated: true });
  await files.remove("/c", { coordinated: true, recursive: true }); await files.readText("/a");
  expect(calls.map(call => [call.method, call.args.coordinated])).toEqual([["readText", true], ["readBytes", true], ["writeText", true], ["writeBytes", true], ["copy", true], ["move", true], ["remove", true], ["readText", false]]);
  expect(calls[4].args.overwrite).toBe(true); expect(calls[6].args.recursive).toBe(true);
  await expect(files.readText("/a", { coordinate: true } as never)).rejects.toMatchObject({ code: "E_UNSUPPORTED_OPTION" });
  await expect(files.writeText("/a", "t", { coordinated: "yes" } as never)).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  platform.OS = "windows"; calls.length = 0;
  await files.readText("C:\\a", { coordinated: false }); expect(calls[0].args.coordinated).toBe(false);
});

test("volume errors are typed", async () => {
  for (const code of ["E_READ_ONLY", "E_NO_SPACE", "E_PERMISSION_DENIED"]) {
    handlers.set("writeText", () => { throw nativeError(code); });
    await expect(files.writeText("/Volumes/X/a", "t")).rejects.toMatchObject({ code });
  }
  handlers.set("writeBytes", () => { throw nativeError("E_PERMISSION"); });
  await expect(files.writeBytes("/a", new Uint8Array())).rejects.toMatchObject({ code: "E_PERMISSION_DENIED" });
});
