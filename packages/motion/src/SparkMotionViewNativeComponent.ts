import type { HostComponent, ViewProps } from "react-native";
import codegenNativeComponent from "react-native/Libraries/Utilities/codegenNativeComponent";
import type { WithDefault } from "react-native/Libraries/Types/CodegenTypes";

export interface NativeProps extends ViewProps {
  /** JSON of the validated `initial` values, applied once at mount. */
  initialValues?: string;
  /** `position` or `frame`: layout changes animate (docs/motion.md#layout-presence-and-shared-elements). */
  layout?: string;
  /** Shared-element id within the window. */
  sharedId?: string;
  /** The shared id also matches MotionViews with this flag in other windows. */
  sharedAcrossWindows?: WithDefault<boolean, false>;
  /** JSON of the validated layout and shared-element transition. */
  transition?: string;
  /** MotionMaterial: JSON of the validated material (`material`, `blendingMode`, `state`, `emphasized`); a change crossfades. */
  material?: string;
  /** MotionMaterial: JSON of the tint color's OKLCH components `[L, C, H, alpha]`. */
  tintColor?: string;
  /** MotionMaterial: JSON of the validated crossfade transition. */
  crossfade?: string;
  /** MotionShape: JSON of the validated paths (one structure of cubic segments) and stroke style. */
  shape?: string;
  /** MotionShader: JSON of the validated built-in effect (`type` and its options). */
  shaderEffect?: string;
  /** MotionEmitter: JSON of the validated emitter (`shape`, `position`, `size`, `blend`, `seed`, `cells`). */
  particleEmitter?: string;
}

export default codegenNativeComponent<NativeProps>("SparkMotionView") as HostComponent<NativeProps>;
