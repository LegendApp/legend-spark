import { SparkError, type Availability } from "@legendapp/spark-desktop-app/src/contracts";
import { getMotionAvailability, motionModule } from "./motion";

// Backdrop materials (docs/motion.md#backdrop-materials): AppKit's NSVisualEffectView materials, and Liquid Glass
// (NSGlassEffectView) where the app's SDK and macOS have it.

/** NSVisualEffectMaterial names, and Liquid Glass: `glass` (regular) and `clearGlass` (macOS 26). */
export type MotionMaterialName =
  | "titlebar" | "selection" | "menu" | "popover" | "sidebar" | "headerView" | "sheet" | "windowBackground" | "hudWindow"
  | "fullScreenUI" | "toolTip" | "contentBackground" | "underWindowBackground" | "underPageBackground"
  | "glass" | "clearGlass";
/** What a material blurs: the desktop and windows behind the window, or the window's own content behind the view. */
export type MotionMaterialBlending = "behindWindow" | "withinWindow";
/** Whether the material looks active: with its window (default), always, or never. */
export type MotionMaterialState = "followsWindowActiveState" | "active" | "inactive";

export const MATERIALS: readonly MotionMaterialName[] = [
  "titlebar", "selection", "menu", "popover", "sidebar", "headerView", "sheet", "windowBackground", "hudWindow",
  "fullScreenUI", "toolTip", "contentBackground", "underWindowBackground", "underPageBackground", "glass", "clearGlass",
];
export const isGlass = (material: MotionMaterialName) => material === "glass" || material === "clearGlass";

/** Whether `material` shows here: motion is available, and the app's SDK and macOS have the material. */
export function getMaterialAvailability(material: MotionMaterialName): Availability {
  if (!MATERIALS.includes(material)) throw new SparkError("E_INVALID_ARGUMENT", `Unknown material ${material}`);
  const motion = getMotionAvailability();
  if (!motion.available) return motion;
  return motionModule().supportsMaterial(material) ? { available: true } : { available: false, reason: "host-restriction" };
}

/** Throws the typed reason `material` is unavailable. */
export function requireMaterial(material: MotionMaterialName) {
  const availability = getMaterialAvailability(material);
  if (availability.available) return;
  if (availability.reason === "host-restriction") throw new SparkError("E_UNAVAILABLE", `The ${material} material needs macOS 26 or later, and an app built with that SDK`);
  throw new SparkError(availability.reason === "unsupported-platform" ? "E_UNSUPPORTED_PLATFORM" : "E_MODULE_UNAVAILABLE", `Materials are unavailable: ${availability.reason}`);
}
