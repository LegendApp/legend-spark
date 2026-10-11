import type { HostComponent, ViewProps } from "react-native";
import codegenNativeComponent from "react-native/Libraries/Utilities/codegenNativeComponent";

export interface NativeProps extends ViewProps {
  /** JSON of the validated `initial` values, applied once at mount. */
  initialValues?: string;
}

export default codegenNativeComponent<NativeProps>("SparkMotionView") as HostComponent<NativeProps>;
