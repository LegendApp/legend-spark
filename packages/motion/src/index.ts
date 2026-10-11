export { spring, timing, keyframes, decay, sequence } from "./specs";
export type {
  MotionProperty, MotionChannelProperty, MotionValues, CubicBezier, Easing, SpringPreset, AnimationOptions, SpringOptions, TimingOptions,
  KeyframesOptions, DecayOptions, SequenceOptions, MotionSpec, SpringSpec, TimingSpec, KeyframesSpec, DecaySpec, SequenceSpec,
} from "./specs";
export { getMotionAvailability, animate, timeline, stagger, setMotionValues, stopMotion, getMotionState, linkScroll, recordMotionFrames } from "./motion";
export type { MotionTarget, MotionAnimationValues, AnimateOptions, MotionAnimation, StaggerOptions, TimelineStep, MotionState, ScrollLinkOptions, MotionFrameReport } from "./motion";
export { MotionView } from "./MotionView";
export type { MotionViewProps } from "./MotionView";
