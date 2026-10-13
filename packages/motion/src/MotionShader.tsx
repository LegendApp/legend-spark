import { useMotionView, type MotionViewProps } from "./MotionView";
import { SHADER_PROPERTIES, shaderEffectJson, type MotionShaderEffect } from "./shaders";

export interface MotionShaderProps extends MotionViewProps {
  /** The built-in effect over the view and its children; its property (`rippleProgress`, …) animates like any motion property. */
  effect: MotionShaderEffect;
}

/**
 * A MotionView with a built-in shader effect (docs/motion.md#shader-effects-and-particles): ripple, dissolve, distortion
 * or a specular sweep, driven by one engine property. Throws a SparkError where motion or the effect is unavailable.
 */
export function MotionShader({ effect, ...props }: MotionShaderProps) {
  const shaderEffect = shaderEffectJson(effect);
  return useMotionView(props, { native: { shaderEffect }, properties: [SHADER_PROPERTIES[effect.type]] });
}
