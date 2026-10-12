import { animate, getMaterialAvailability, spring, timing, type MotionMaterialName, type MotionTarget } from "@legendapp/spark/motion";
import { settledValues } from "./effects-demo";

// Demo operations for Motion system > Backdrop materials, through the public @legendapp/spark/motion boundary. Each
// returns the JSON-ready result its readout shows: the animation's outcome and the value it settled at.

/** The materials Next steps through; each change crossfades in over the material showing. */
export const STEPS: readonly MotionMaterialName[] = ["hudWindow", "popover", "sidebar", "menu"];
/** A violet tint over the material, shown at materialTintOpacity. */
export const TINT = "#7c3aed59";

/** AppKit's visual effect materials (macOS 10.14 and later), and Liquid Glass (macOS 26 and an app built with its SDK). */
const VISUAL_EFFECTS: readonly MotionMaterialName[] = ["titlebar", "selection", "menu", "popover", "sidebar", "headerView", "sheet", "windowBackground", "hudWindow",
  "fullScreenUI", "toolTip", "contentBackground", "underWindowBackground", "underPageBackground"];
const GLASS: readonly MotionMaterialName[] = ["glass", "clearGlass"];
const availability = (materials: readonly MotionMaterialName[]) => Object.fromEntries(materials.map(material => [material, getMaterialAvailability(material).available]));
/** Whether this app on this macOS has each material. */
export const materialAvailability = () => ({ visualEffects: availability(VISUAL_EFFECTS), glass: availability(GLASS) });

/** Fades the material in or out (its intensity); what is behind the panel shows unblurred at 0. */
export const fadeMaterial = (target: MotionTarget | null, shown: boolean) =>
  settledValues(target, animate(target, { materialIntensity: timing(shown ? 1 : 0, { durationMs: 400 }) }).finished, ["materialIntensity"]);

/** Springs the tint over the material in or out. */
export const tintMaterial = (target: MotionTarget | null, shown: boolean) =>
  settledValues(target, animate(target, { materialTintOpacity: spring(shown ? 1 : 0, { preset: "smooth" }) }).finished, ["materialTintOpacity"]);
