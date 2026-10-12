import type { HostComponent, ViewProps } from "react-native";
import type { DirectEventHandler, WithDefault } from "react-native/Libraries/Types/CodegenTypes";
import codegenNativeComponent from "react-native/Libraries/Utilities/codegenNativeComponent";

export interface NativeProps extends ViewProps {
  onUnavailable?: DirectEventHandler<Readonly<{ message: string }>>;
  title: string;
  disabled?: WithDefault<boolean, false>;
  variant?: WithDefault<"default" | "bordered" | "borderless" | "push" | "bevel" | "toolbar" | "help" | "cancel" | "destructive", "push">;
  controlSize?: WithDefault<"mini" | "small" | "regular" | "large", "regular">;
  onButtonPress?: DirectEventHandler<Readonly<{}>>;
}
export default codegenNativeComponent<NativeProps>("SparkButton") as HostComponent<NativeProps>;
