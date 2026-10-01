import { expect, test, vi } from "vitest";
import { callBinary, nativeBytes } from "../packages/desktop-app/src/contracts/native-buffer";
test("binary calls submit exact views immediately without encoding or copying in JS", async () => {
  const data = new Uint8Array([9, 0, 255, 1, 9]), bytes = data.subarray(1, 4);
  const native = { binaryCall: vi.fn().mockResolvedValue(null) };
  const operation = callBinary(native, "unused", "write", { id: "file", offset: 17 }, bytes);
  expect(native.binaryCall).toHaveBeenCalledWith("write", '{"id":"file","offset":17}', data.buffer, 1, 3);
  await operation;
  const buffer = new Uint8Array([0, 255]).buffer, result = nativeBytes(buffer);
  expect(result.buffer).toBe(buffer); result[1] = 128; expect(new Uint8Array(buffer)[1]).toBe(128);
  expect(() => nativeBytes(buffer, 1)).toThrow("buffer"); expect(() => nativeBytes("base64")).toThrow("buffer");
});
test("Windows installs its direct function once and missing bindings fail explicitly", async () => {
  const name = "__sparkTestBinary", globals = globalThis as unknown as Record<string, unknown>;
  const call = vi.fn().mockResolvedValue(new ArrayBuffer(0));
  const native = { installBinary: vi.fn(() => { globals[name] = call; return null; }) };
  try { await callBinary(native, name, "read", {}); await callBinary(native, name, "read", {}); expect(native.installBinary).toHaveBeenCalledOnce(); expect(call).toHaveBeenCalledTimes(2); }
  finally { delete globals[name]; }
  expect(() => callBinary({}, name, "read", {})).toThrow("unavailable");
  expect(() => callBinary({ installBinary: () => "The runtime does not expose JSI" }, name, "read", {})).toThrow("JSI");
});

import { readFileSync } from "node:fs";
import path from "node:path";
test("native buffer headers resolve in both the checkout and installed package layout", () => {
  const root = path.resolve(import.meta.dirname, "../packages");
  for (const [directory, project] of [["file-system", "SparkFileSystem"], ["clipboard", "SparkClipboard"], ["processes", "SparkProcesses"]]) {
    const source = path.join(root, directory, "windows", project);
    expect(readFileSync(path.join(source, `${project}.h`), "utf8")).toContain("#include <SparkBinaryWindows.hpp>");
    const xml = readFileSync(path.join(source, `${project}.vcxproj`), "utf8");
    const includes = xml.match(/<AdditionalIncludeDirectories>([\s\S]*?)<\/AdditionalIncludeDirectories>/)![1].split(";").map(value => value.trim()).filter(value => value.startsWith("$(MSBuildThisFileDirectory)"));
    const resolve = (base: string) => includes.map(value => path.resolve(base, value.replace("$(MSBuildThisFileDirectory)", "").replaceAll("\\", "/")));
    expect(resolve(source)).toContain(path.join(root, "desktop-app", "cpp"));
    expect(resolve(`/node_modules/@legendapp/spark-${directory}/windows/${project}`)).toContain("/node_modules/@legendapp/spark-desktop-app/cpp");
  }
  const metadata = JSON.parse(readFileSync(path.join(root, "desktop-app/package.json"), "utf8"));
  expect(metadata.files).toContain("cpp");
  expect(readFileSync(path.join(root, "desktop-app/RNDesktopApp.podspec"), "utf8")).toContain('"cpp/**/*.hpp"');
});
