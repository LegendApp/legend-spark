import type { HostComponent, ViewProps } from "react-native";
import type { DirectEventHandler, Double, Int32, WithDefault } from "react-native/Libraries/Types/CodegenTypes";
import codegenNativeComponent from "react-native/Libraries/Utilities/codegenNativeComponent";

export interface NativeProps extends ViewProps {
  onUnavailable?: DirectEventHandler<Readonly<{ message: string }>>;
  title: string;
  disabled?: WithDefault<boolean, false>;
  variant?: WithDefault<"default" | "bordered" | "borderless" | "checkbox" | "disclosure", "default">;
  /** Checkbox value or disclosure expansion; re-applied whenever checkedRevision changes. */
  checked?: WithDefault<boolean, false>;
  checkedRevision?: Int32;
  onButtonPress?: DirectEventHandler<Readonly<{}>>;
  onIntrinsicSize?: DirectEventHandler<Readonly<{ width: Double; height: Double }>>;
}
export default codegenNativeComponent<NativeProps>("SparkButton") as HostComponent<NativeProps>;
