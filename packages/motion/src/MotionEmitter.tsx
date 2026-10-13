import { useMotionView, type MotionViewProps } from "./MotionView";
import { emitterJson, type ParticleEmitter } from "./particles";

export interface MotionEmitterProps extends MotionViewProps {
  /** The emitter: its shape and position, and the particles it emits once startParticles starts it. */
  emitter: ParticleEmitter;
}

/**
 * A MotionView that emits particles over its children (docs/motion.md#shader-effects-and-particles), between
 * startParticles and stopParticles. Throws a SparkError where motion is unavailable.
 */
export function MotionEmitter({ emitter, ...props }: MotionEmitterProps) {
  return useMotionView(props, { native: { particleEmitter: emitterJson(emitter) }, properties: [] });
}
