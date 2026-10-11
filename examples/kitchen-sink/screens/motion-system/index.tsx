import { defineScreens } from "../../shell/registry";
import { ScrollAndFrames, Springs, Timelines } from "./MotionScreens";

export default defineScreens("motion-system", [
  { id: "springs", title: "Springs and interruption", summary: "Platform spring presets, interruption that keeps velocity, and a gesture release velocity hand-off.", component: Springs },
  { id: "timelines", title: "Keyframes and timelines", summary: "Keyframes, a repeating reversed sequence, a stagger, a timeline step after the previous one, and clamped decay.", component: Timelines },
  { id: "scroll-and-frames", title: "Scroll link and JS block", summary: "A scroll-linked badge driven on the native main thread, and frames recorded while JavaScript is blocked for 500 ms.", component: ScrollAndFrames },
]);
