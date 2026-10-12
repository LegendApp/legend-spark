export { spring, timing, keyframes, decay, sequence } from "./specs";
export type {
  MotionProperty, MotionChannelProperty, MotionValues, CubicBezier, Easing, SpringPreset, AnimationOptions, SpringOptions, TimingOptions,
  KeyframesOptions, DecayOptions, SequenceOptions, MotionSpec, SpringSpec, TimingSpec, KeyframesSpec, DecaySpec, SequenceSpec, MotionTransition,
} from "./specs";
export { getMotionAvailability, animate, timeline, stagger, setMotionValues, stopMotion, getMotionState, linkScroll, recordMotionFrames, getMotionEnvironment } from "./motion";
export type { MotionTarget, MotionAnimationValues, AnimateOptions, MotionAnimation, StaggerOptions, TimelineStep, MotionState, ScrollLinkOptions, MotionFrameReport,
  ReducedMotion, MotionHaptic, MotionCue, MotionPlanOptions, MotionEnvironment,
} from "./motion";
export { MotionView } from "./MotionView";
export type { MotionViewProps } from "./MotionView";
export { MotionPresence } from "./MotionPresence";
export type { MotionPresenceProps } from "./MotionPresence";
