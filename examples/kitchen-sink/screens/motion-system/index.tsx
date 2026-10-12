import { defineScreens } from "../../shell/registry";
import { VisualEffects } from "./EffectsScreen";
import { Layout } from "./LayoutScreen";
import { MATERIALS_MESSAGES } from "./materials-messages";
import { Materials } from "./MaterialsScreen";
import { AccessibilityPower, ScrollAndFrames, Springs, Timelines } from "./MotionScreens";
import { TextAndSymbols } from "./TextSymbolsScreen";

export default defineScreens("motion-system", [
  { id: "springs", title: "Springs and interruption", summary: "Platform spring presets, interruption that keeps velocity, and a gesture release velocity hand-off.", component: Springs },
  { id: "timelines", title: "Keyframes and timelines", summary: "Keyframes, a repeating reversed sequence, a stagger, a timeline step after the previous one, and clamped decay.", component: Timelines },
  { id: "scroll-and-frames", title: "Scroll link and JS block", summary: "A scroll-linked badge driven on the native main thread, and frames recorded while JavaScript is blocked for 500 ms.", component: ScrollAndFrames },
  { id: "layout", title: "Layout, presence and shared elements", summary: "Rows that enter, exit and reflow with layout animation, a frame that scales to its new size, and a shared element between a thumbnail and its detail.", component: Layout },
  { id: "visual-effects", title: "Visual effects", summary: "Background colors that animate in OKLCH, corner radius, shadow and blur, 3D rotation in perspective, mask reveals and a path, all on the compositor.", component: VisualEffects },
  { id: "materials", title: MATERIALS_MESSAGES.en.title, titles: { ar: MATERIALS_MESSAGES.ar.title }, summary: "A backdrop material that crossfades between materials and to Liquid Glass, with its intensity and tint animated on the compositor; Reduce Motion and Reduce Transparency followed.", component: Materials },
  { id: "text-and-symbols", title: "Text and symbols", summary: "Rolling digits, per-character crossfade and typewriter text, and SF Symbol effects with a replace transition.", component: TextAndSymbols },
  { id: "accessibility-power", title: "Accessibility, power and lifecycle", summary: "Reduce Motion alternates, the frame rate for the display and Low Power Mode, pausing in a hidden window, cancelling on unmount, and haptic and sound cues on frames.", component: AccessibilityPower },
]);
