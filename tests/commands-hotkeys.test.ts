import { expect, test, vi } from "vitest";
vi.mock("react-native", () => ({ Platform: { OS: "macos" } }));
import { Platform } from "react-native";
import { matchesHotkey, normalizeBinding, bindingFromEvent, formatHotkey } from "../packages/commands/src/bindings";
const event = (key: string, modifiers = 0, keyCode = 0) => ({ key, keyCode, modifiers, repeated: false, consumed: false, captured: false, windowId: "main" });
test("commands use the shared named syntax and character labels rather than numeric virtual codes", () => {
  expect(matchesHotkey(event("a"), "A")).toBe(true);
  expect(matchesHotkey(event("1", 0, 18), "1")).toBe(true);
  expect(matchesHotkey(event("s", 1 << 20, 1), "Command+S")).toBe(true);
  expect(normalizeBinding("commandorcontrol+shift+k")).toBe("CmdOrCtrl+Shift+K");
  for (const value of [0, "1048576+0", "Command+KeyO", "Cmd+Cmd+S"]) expect(() => normalizeBinding(value as never)).toThrow();
});
test("navigation ignores implicit Fn but explicit modifiers still match exactly", () => {
  expect(matchesHotkey(event("\uf700", (1 << 23) | 0x100), "Up")).toBe(true);
  expect(matchesHotkey(event("\uf700", (1 << 23) | (1 << 17)), "Shift+Up")).toBe(true);
  expect(matchesHotkey(event("\uf700", 1 << 23), "Shift+Up")).toBe(false);
  expect(matchesHotkey(event("\uf700"), "Fn+Up")).toBe(false);
  expect(matchesHotkey(event("\uf700", 1 << 23), "Fn+Up")).toBe(true);
});
test("binding capture preserves media/navigation names and ignores incidental caps lock", () => {
  expect(bindingFromEvent(event("MediaPlayPause"))).toBe("MediaPlayPause");
  expect(bindingFromEvent(event("\uf729", 1 << 23))).toBe("Home");
  expect(bindingFromEvent(event("s", (1 << 20) | (1 << 16)))).toBe("Cmd+S");
  expect(formatHotkey("Cmd+Shift+S")).toBe("⌘ + ⇧ + S");
  expect(formatHotkey("MediaPlayPause")).toBe("⏯");
  expect(formatHotkey("MediaNext")).toBe("⏭");
  expect(formatHotkey("MediaPrevious")).toBe("⏮");
  expect(formatHotkey("Cmd+MediaPlayPause")).toBe("⌘ + ⏯");
});

test("Windows media-key labels use words instead of raw key names", () => {
  const previous = Platform.OS;
  Platform.OS = "windows";
  try {
    expect(formatHotkey("MediaPlayPause")).toBe("Play/Pause");
    expect(formatHotkey("MediaNext")).toBe("Next Track");
    expect(formatHotkey("MediaPrevious")).toBe("Previous Track");
    expect(formatHotkey("Ctrl+MediaNext")).toBe("Ctrl + Next Track");
  } finally {
    Platform.OS = previous;
  }
});
