import type { CodegenTypes, HostComponent, ViewProps } from "react-native";
import { codegenNativeComponent } from "react-native";

export interface NativeProps extends ViewProps {
  variant?: CodegenTypes.WithDefault<"bar" | "spinner", "bar">;
  controlSize?: CodegenTypes.WithDefault<"regular" | "small" | "mini", "regular">;
  /** Determinate progress from 0 to 1; ignored while `indeterminate`. */
  value?: CodegenTypes.Double;
  indeterminate?: CodegenTypes.WithDefault<boolean, true>;
  onIntrinsicSize?: CodegenTypes.DirectEventHandler<Readonly<{ width: CodegenTypes.Double; height: CodegenTypes.Double }>>;
}

export default codegenNativeComponent<NativeProps>("SparkProgressIndicator") as HostComponent<NativeProps>;
