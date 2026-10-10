import type { CodegenTypes, HostComponent, ViewProps } from "react-native";
import { codegenNativeComponent } from "react-native";

export interface NativeProps extends ViewProps {
  onUnavailable?: CodegenTypes.DirectEventHandler<Readonly<{ message: string }>>;
  title: string;
  disabled?: CodegenTypes.WithDefault<boolean, false>;
  variant?: CodegenTypes.WithDefault<"default" | "bordered" | "borderless", "default">;
  onButtonPress?: CodegenTypes.DirectEventHandler<Readonly<{}>>;
}
export default codegenNativeComponent<NativeProps>("SparkButton") as HostComponent<NativeProps>;
