import type { CodegenTypes, ColorValue, HostComponent, ViewProps } from "react-native";
import codegenNativeComponent from "react-native/Libraries/Utilities/codegenNativeComponent";

export interface NativeProps extends ViewProps {
  /** An SF Symbol name that exists on this macOS (JavaScript checks it). */
  name: string;
  size?: CodegenTypes.Double;
  color?: ColorValue;
  /** `replace`, `downUp`, `upUp` or `offUp`: how a name change animates; empty sets the new symbol at once. */
  replaceTransition?: string;
}

export default codegenNativeComponent<NativeProps>("SparkMotionSymbol") as HostComponent<NativeProps>;
