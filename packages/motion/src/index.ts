export { spring, timing, keyframes, decay, sequence } from "./specs";
export { motionPath } from "./path";
export type { MotionPathOptions, MotionPathValues } from "./path";
export type { MotionColor } from "./colors";
export type {
  MotionProperty, MotionNumberProperty, MotionColorProperty, MotionValue, MotionChannelProperty, MotionValues, CubicBezier, Easing, SpringPreset, AnimationOptions, SpringOptions, TimingOptions,
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
export { MotionNumber } from "./MotionNumber";
export type { MotionNumberProps } from "./MotionNumber";
export { MotionText } from "./MotionText";
export type { MotionTextProps, MotionTextTransition } from "./MotionText";
export { MotionSymbol } from "./MotionSymbol";
export type { MotionSymbolProps } from "./MotionSymbol";
export { getSymbolEffectAvailability, playSymbolEffect, stopSymbolEffects } from "./symbols";
export { MotionMaterial } from "./MotionMaterial";
export type { MotionMaterialProps } from "./MotionMaterial";
export { getMaterialAvailability } from "./materials";
export type { MotionMaterialName, MotionMaterialBlending, MotionMaterialState } from "./materials";
export { MotionShape } from "./MotionShape";
export type { MotionShapeProps } from "./MotionShape";
export type { MotionShapeLineCap, MotionShapeLineJoin, MotionShapeFillRule } from "./shapes";
export { MotionShader } from "./MotionShader";
export type { MotionShaderProps } from "./MotionShader";
export { getShaderEffectAvailability } from "./shaders";
export type { ShaderEffect, MotionShaderEffect, MotionPoint, RippleEffect, DissolveEffect, DistortionEffect, SpecularEffect } from "./shaders";
export { MotionEmitter } from "./MotionEmitter";
export type { MotionEmitterProps } from "./MotionEmitter";
export { getParticleAvailability, startParticles, stopParticles } from "./particles";
export type { ParticleEmitter, ParticleCell, ParticleImage, ParticleOptions, ParticlePlayback } from "./particles";
export type { MotionSymbolTarget, SymbolEffect, SymbolEffectDirection, SymbolEffectOptions, SymbolEffectPlayback, SymbolReplaceTransition } from "./symbols";
