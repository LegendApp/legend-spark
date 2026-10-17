import { Platform } from "react-native";
import { SparkError } from "./index";

/** Desktop platforms that have a reserved-shortcut table. */
export type ShortcutPlatform = "macos" | "windows";
/** `reserved` bindings are rejected with E_BUSY; `warning` bindings are accepted and reported as conflicts. */
export interface ReservedShortcut { accelerator: string; platform: ShortcutPlatform; severity: "reserved" | "warning"; description: string }

const RESERVED: Record<ShortcutPlatform, readonly [string, ReservedShortcut["severity"], string][]> = {
  macos: [
    ["Cmd+Tab", "reserved", "Switches apps"], ["Cmd+Shift+Tab", "reserved", "Switches apps in reverse"],
    ["Cmd+Alt+Escape", "reserved", "Opens Force Quit Applications"], ["Cmd+Ctrl+Q", "reserved", "Locks the screen"], ["Cmd+Shift+Q", "reserved", "Logs out"],
    ["Cmd+Space", "warning", "Spotlight"], ["Ctrl+Space", "warning", "Selects the previous input source"], ["Cmd+Ctrl+Space", "warning", "Character Viewer"],
    ["Cmd+Shift+3", "warning", "Screenshot of the screen"], ["Cmd+Shift+4", "warning", "Screenshot of a selection"], ["Cmd+Shift+5", "warning", "Screenshot and recording options"],
    ["Ctrl+Up", "warning", "Mission Control"], ["Ctrl+Down", "warning", "Application windows"], ["Ctrl+Left", "warning", "Moves one space left"], ["Ctrl+Right", "warning", "Moves one space right"],
    ["Cmd+Q", "warning", "Quits the app"], ["Cmd+H", "warning", "Hides the app"], ["Cmd+Alt+H", "warning", "Hides other apps"], ["Cmd+M", "warning", "Minimizes the window"], ["Cmd+`", "warning", "Cycles the app's windows"],
  ],
  // Cmd is the Windows key on Windows.
  windows: [
    ["Ctrl+Alt+Delete", "reserved", "Secure attention sequence"], ["Alt+Tab", "reserved", "Switches windows"], ["Alt+Shift+Tab", "reserved", "Switches windows in reverse"],
    ["Ctrl+Shift+Escape", "reserved", "Opens Task Manager"], ["Ctrl+Escape", "reserved", "Opens Start"], ["Cmd+L", "reserved", "Locks the PC"],
    ["Cmd+D", "reserved", "Shows the desktop"], ["Cmd+Tab", "reserved", "Opens Task View"], ["Cmd+R", "reserved", "Opens Run"], ["Cmd+E", "reserved", "Opens File Explorer"],
    ["Alt+F4", "warning", "Closes the window"], ["Alt+Space", "warning", "Opens the window menu"],
    ["Cmd+Up", "warning", "Maximizes the window"], ["Cmd+Down", "warning", "Restores or minimizes the window"], ["Cmd+Left", "warning", "Snaps the window left"], ["Cmd+Right", "warning", "Snaps the window right"],
  ],
};

export const currentShortcutPlatform = (): ShortcutPlatform => Platform.OS === "windows" ? "windows" : "macos";

/** Shortcuts the OS owns. The list is documented in docs/commands.md. */
export function getReservedShortcuts(platform: ShortcutPlatform = currentShortcutPlatform()): readonly ReservedShortcut[] {
  if (platform !== "macos" && platform !== "windows") throw new SparkError("E_INVALID_ARGUMENT", "Expected macos or windows");
  return RESERVED[platform].map(([accelerator, severity, description]) => ({ accelerator, platform, severity, description }));
}
