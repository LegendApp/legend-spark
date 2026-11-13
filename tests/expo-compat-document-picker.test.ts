import { beforeEach, expect, test, vi } from "vitest";
const openFileDialog = vi.fn();
const files = { getDirectory: vi.fn(), mkdir: vi.fn(), stat: vi.fn(), copy: vi.fn() };
vi.doMock("@legendapp/spark-file-dialog", () => ({ openFileDialog }));
vi.doMock("@legendapp/spark-file-system", () => files);
const picker = await import("../packages/expo-compat/src/document-picker");
beforeEach(() => {
  vi.clearAllMocks();
  files.getDirectory.mockResolvedValue("/Library/Caches/app");
  files.stat.mockResolvedValue({ type: "file", size: 42, modifiedAt: 123 });
  openFileDialog.mockResolvedValue({ canceled: false, paths: ["/tmp/a #1.txt"] });
});
test("accepted documents copy to app caches by default and preserve original metadata", async () => {
  const result = await picker.getDocumentAsync({ type: ["text/plain", "application/pdf"], multiple: true });
  expect(openFileDialog).toHaveBeenCalledWith({ multiple: true, filters: [{ extensions: ["txt", "text", "pdf"] }] });
  expect(files.getDirectory).toHaveBeenCalledWith("cache");
  expect(files.mkdir).toHaveBeenCalledWith("/Library/Caches/app/DocumentPicker");
  expect(files.copy).toHaveBeenCalledWith("/tmp/a #1.txt", expect.stringMatching(/^\/Library\/Caches\/app\/DocumentPicker\/\d+-\d+-a #1.txt$/));
  expect(result).toEqual({ canceled: false, assets: [{ name: "a #1.txt", uri: expect.stringMatching(/^file:\/\/\/Library\/Caches\/app\/DocumentPicker\/\d+-\d+-a%20%231.txt$/), size: 42, lastModified: 123, mimeType: "text/plain" }] });
});
test("cancel returns Expo's null assets without filesystem work", async () => {
  openFileDialog.mockResolvedValue({ canceled: true });
  expect(await picker.getDocumentAsync()).toEqual({ canceled: true, assets: null });
  expect(files.getDirectory).not.toHaveBeenCalled();
  expect(files.stat).not.toHaveBeenCalled();
});
test("copyToCacheDirectory false preserves original URLs and unknown MIME metadata stays absent", async () => {
  openFileDialog.mockResolvedValue({ canceled: false, paths: ["/tmp/a.unknown", "/tmp/b.pdf"] });
  expect(await picker.getDocumentAsync({ copyToCacheDirectory: false })).toEqual({ canceled: false, assets: [
    { name: "a.unknown", uri: "file:///tmp/a.unknown", size: 42, lastModified: 123 },
    { name: "b.pdf", uri: "file:///tmp/b.pdf", size: 42, lastModified: 123, mimeType: "application/pdf" },
  ] });
  expect(files.copy).not.toHaveBeenCalled();
  expect(files.mkdir).not.toHaveBeenCalled();
});
test("wildcards map to supported extensions; unknown types and unsupported options never silently widen a pick", async () => {
  openFileDialog.mockResolvedValue({ canceled: true });
  await picker.getDocumentAsync({ type: "image/*" });
  expect(openFileDialog.mock.calls[0][0].filters[0].extensions).toEqual(expect.arrayContaining(["png", "jpg", "heic"]));
  openFileDialog.mockClear();
  for (const options of [{ type: "application/not-supported" }, { base64: true }, { title: "ignored" }]) await expect(picker.getDocumentAsync(options as never)).rejects.toMatchObject({ code: "ERR_UNAVAILABLE" });
  for (const options of [{ type: [] }, { type: "bad" }, { multiple: "true" }]) await expect(picker.getDocumentAsync(options as never)).rejects.toMatchObject({ code: "ERR_INVALID_ARGUMENT" });
  expect(openFileDialog).not.toHaveBeenCalled();
});
test("copy failures reject instead of reporting an asset that cannot be read", async () => {
  const error = new Error("disk error");
  files.copy.mockRejectedValueOnce(error);
  await expect(picker.getDocumentAsync()).rejects.toBe(error);
});
test("non-regular files reject rather than reporting symlink metadata as document metadata", async () => {
  files.stat.mockResolvedValueOnce({ type: "symlink", size: 10, modifiedAt: 123 });
  await expect(picker.getDocumentAsync()).rejects.toMatchObject({ code: "ERR_UNAVAILABLE" });
  expect(files.copy).not.toHaveBeenCalled();
});
