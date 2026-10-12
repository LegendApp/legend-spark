import type { HostComponent, ViewProps } from "react-native";
import codegenNativeComponent from "react-native/Libraries/Utilities/codegenNativeComponent";

export interface NativeProps extends ViewProps {
  /** JSON of the validated `initial` values, applied once at mount. */
  initialValues?: string;
  /** `position` or `frame`: layout changes animate (docs/motion.md#layout-presence-and-shared-elements). */
  layout?: string;
  /** Shared-element id within the window. */
  sharedId?: string;
  /** JSON of the validated layout and shared-element transition. */
  transition?: string;
  /** MotionMaterial: JSON of the validated material (`material`, `blendingMode`, `state`, `emphasized`); a change crossfades. */
  material?: string;
  /** MotionMaterial: JSON of the tint color's OKLCH components `[L, C, H, alpha]`. */
  tintColor?: string;
  /** MotionMaterial: JSON of the validated crossfade transition. */
  crossfade?: string;
}

export default codegenNativeComponent<NativeProps>("SparkMotionView") as HostComponent<NativeProps>;
