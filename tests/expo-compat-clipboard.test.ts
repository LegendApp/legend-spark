import { beforeEach, expect, test, vi } from "vitest";
const { readClipboard, writeClipboard, getStringAsync, setStringAsync } = vi.hoisted(() => ({ readClipboard: vi.fn(), writeClipboard: vi.fn(), getStringAsync: vi.fn(), setStringAsync: vi.fn() }));
vi.mock("@legendapp/spark-clipboard", () => ({ readClipboard, writeClipboard, getStringAsync, setStringAsync, hasStringAsync: async () => true, StringFormat: { HTML: "html", PLAIN_TEXT: "plainText" } }));
import * as clipboard from "../packages/expo-compat/src/clipboard";
import { toByteArray } from "base64-js";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAAEklEQVR4nGP4z8DwHxkzoAsAAA8hD/EEN8afAAAAAElFTkSuQmCC";
beforeEach(() => { vi.clearAllMocks(); readClipboard.mockResolvedValue({}); });
test("string and HTML calls keep the backend's Expo-shaped options and result", async () => {
  setStringAsync.mockResolvedValue(false); getStringAsync.mockResolvedValue("<b>hello</b>");
  expect(await clipboard.setStringAsync("<b>hello</b>", { inputFormat: clipboard.StringFormat.HTML })).toBe(false);
  expect(await clipboard.getStringAsync({ preferredFormat: clipboard.StringFormat.HTML })).toBe("<b>hello</b>");
  expect(setStringAsync).toHaveBeenCalledWith("<b>hello</b>", { inputFormat: "html" });
  expect(getStringAsync).toHaveBeenCalledWith({ preferredFormat: "html" });
});
test("PNG bridge translates Expo base64 to bytes and returns data URI with actual dimensions", async () => {
  const bytes = toByteArray(PNG);
  await clipboard.setImageAsync(PNG);
  expect(writeClipboard).toHaveBeenCalledWith({ image: { format: "png", bytes } });
  readClipboard.mockResolvedValue({ image: { format: "png", bytes } });
  expect(await clipboard.hasImageAsync()).toBe(true);
  expect(await clipboard.getImageAsync({ format: "png" })).toEqual({ data: `data:image/png;base64,${PNG}`, size: { width: 4, height: 2 } });
  readClipboard.mockResolvedValue({});
  expect(await clipboard.hasImageAsync()).toBe(false);
  expect(await clipboard.getImageAsync({ format: "png" })).toBeNull();
});
test("unsupported formats/listeners and invalid PNG cannot silently succeed", async () => {
  await expect(clipboard.getImageAsync({ format: "jpeg" })).rejects.toMatchObject({ code: "ERR_UNAVAILABLE" });
  await expect(clipboard.getImageAsync({ format: "png", jpegQuality: 0.5 })).rejects.toMatchObject({ code: "ERR_UNAVAILABLE" });
  await expect(clipboard.setImageAsync("aGVsbG8=")).rejects.toThrow("PNG");
  await expect(clipboard.setImageAsync(`data:image/png;base64,${PNG}`)).rejects.toThrow("base64");
  await expect(clipboard.getUrlAsync()).rejects.toMatchObject({ code: "ERR_UNAVAILABLE" });
  await expect(clipboard.setUrlAsync("https://example.com")).rejects.toMatchObject({ code: "ERR_UNAVAILABLE" });
  await expect(clipboard.hasUrlAsync()).rejects.toMatchObject({ code: "ERR_UNAVAILABLE" });
  expect(() => clipboard.setString("sync")).toThrow(expect.objectContaining({ code: "ERR_UNAVAILABLE" }));
  expect(() => clipboard.ClipboardPasteButton()).toThrow(expect.objectContaining({ code: "ERR_UNAVAILABLE" }));
  expect(clipboard.isPasteButtonAvailable).toBe(false);
  expect(writeClipboard).not.toHaveBeenCalled();
  expect(() => clipboard.addClipboardListener(() => {})).toThrow(expect.objectContaining({ code: "ERR_UNAVAILABLE" }));
});
