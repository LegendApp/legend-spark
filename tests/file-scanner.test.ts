import { beforeEach, expect, test, vi } from "vitest";
const { native, listeners, runs, platform } = vi.hoisted(() => {
  const listeners = new Map<string, Set<(value: unknown) => void>>();
  const runs = new Map<string, { resolve(value: string): void; reject(error: unknown): void }>();
  return { listeners, runs, platform: { OS: "macos" }, native: {
    scanFiles: vi.fn((id: string, _paths: string, _options: string) => new Promise<string>((resolve, reject) => runs.set(id, { resolve, reject }))),
    cancelScan: vi.fn(async (id: string) => { runs.get(id)?.reject(Object.assign(new Error("cancelled"), { code: "E_ABORTED" })); }),
  } };
});
vi.mock("react-native", () => ({
  Platform: platform, TurboModuleRegistry: { get: () => native },
  NativeEventEmitter: class {
    addListener(name: string, listener: (value: unknown) => void) {
      const set = listeners.get(name) ?? new Set(); set.add(listener); listeners.set(name, set);
      return { remove() { set.delete(listener); } };
    }
  },
}));
import { scanFiles, getFileScanAvailability } from "../packages/file-system/src/file-scanner";
const emit = (name: string, value: unknown) => { for (const listener of listeners.get(name) ?? []) listener(value); };
const result = JSON.stringify({ totalFiles: 1, totalRoots: 1, errors: [] });
const file = { absolutePath: "/root/a.txt", fileName: "a.txt", relativePath: "a.txt", extension: "txt", rootIndex: 0, modifiedTime: 100, size: 3 };
beforeEach(() => { vi.clearAllMocks(); listeners.clear(); runs.clear(); platform.OS = "macos"; });
test("concurrent scans have separate callbacks and release their listeners", async () => {
  const first = vi.fn(), second = vi.fn();
  const a = scanFiles(["/root"], { onBatch: first, extensions: ["txt"] });
  const b = scanFiles(["/root"], { onBatch: second });
  const [aID, bID] = native.scanFiles.mock.calls.map(call => call[0]);
  expect(aID).not.toBe(bID);
  emit("onFileScanBatch", { id: aID, files: [file], rootIndex: 0, completedRoots: 0, totalRoots: 1 });
  expect(second).not.toHaveBeenCalled();
  expect(first.mock.calls[0][0].files[0]).toEqual({ path: "/root/a.txt", name: "a.txt", relativePath: "a.txt", extension: "txt", rootIndex: 0, modifiedAt: 100, size: 3, skipped: false });
  runs.get(aID)!.resolve(result); await a;
  emit("onFileScanBatch", { id: aID, files: [file], rootIndex: 0, completedRoots: 0, totalRoots: 1 });
  expect(first).toHaveBeenCalledTimes(1);
  runs.get(bID)!.resolve(result); await b;
  expect([...listeners.values()].every(set => set.size === 0)).toBe(true);
});
test("abort cancels its native scan and does not deliver later batches", async () => {
  const controller = new AbortController(), onBatch = vi.fn();
  const promise = scanFiles(["/root"], { signal: controller.signal, onBatch });
  const id = native.scanFiles.mock.calls[0][0]; controller.abort("stop");
  emit("onFileScanBatch", { id, files: [file], rootIndex: 0, completedRoots: 0, totalRoots: 1 });
  await expect(promise).rejects.toMatchObject({ code: "E_ABORTED", cause: "stop" });
  expect(native.cancelScan).toHaveBeenCalledWith(id); expect(onBatch).not.toHaveBeenCalled();
  expect([...listeners.values()].every(set => set.size === 0)).toBe(true);
  await expect(scanFiles(["/root"], { signal: controller.signal })).rejects.toMatchObject({ code: "E_ABORTED" });
  expect(native.scanFiles).toHaveBeenCalledTimes(1);
});
test("bad native events and callback failures cancel the operation and reject its promise", async () => {
  let promise = scanFiles(["/root"], { onBatch: () => {} });
  let id = native.scanFiles.mock.calls.at(-1)![0];
  emit("onFileScanBatch", { id, files: [{}], rootIndex: 0, completedRoots: 0, totalRoots: 1 });
  await expect(promise).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  const failure = new Error("consumer failed");
  promise = scanFiles(["/root"], { onProgress() { throw failure; } });
  id = native.scanFiles.mock.calls.at(-1)![0];
  emit("onFileScanProgress", { id, rootIndex: 0, completedRoots: 1, totalRoots: 1 });
  await expect(promise).rejects.toBe(failure);
});
test("scan validation and availability never fabricate an empty successful scan", async () => {
  await expect(scanFiles(["relative"])).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  await expect(scanFiles(["/root"], { batchSize: -1 })).rejects.toMatchObject({ code: "E_INVALID_ARGUMENT" });
  const promise = scanFiles(["/root"]);
  runs.get(native.scanFiles.mock.calls[0][0])!.resolve("bad JSON");
  await expect(promise).rejects.toMatchObject({ code: "E_INVALID_DATA" });
  platform.OS = "windows";
  expect(getFileScanAvailability()).toEqual({ available: false, reason: "unsupported-platform" });
  await expect(scanFiles(["C:/root"])).rejects.toMatchObject({ code: "E_UNSUPPORTED_PLATFORM" });
});
