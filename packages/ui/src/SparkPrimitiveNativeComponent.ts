import type { HostComponent, ViewProps } from "react-native";
import type { DirectEventHandler, Int32, WithDefault } from "react-native/Libraries/Types/CodegenTypes";
import codegenNativeComponent from "react-native/Libraries/Utilities/codegenNativeComponent";

export interface NativeProps extends ViewProps {
  kind: string;
  controlSize: string;
  valueJson: string;
  /** The latest native event count JS has processed; native reconciles `valueJson` only when caught up. */
  eventCount: Int32;
  disabled?: WithDefault<boolean, false>;
  onValueChange?: DirectEventHandler<Readonly<{ valueJson: string; eventCount: Int32 }>>;
  /** A native value or configuration that could not cross the JSON boundary. */
  onNativeError?: DirectEventHandler<Readonly<{ message: string; eventCount: Int32 }>>;
}
export default codegenNativeComponent<NativeProps>("SparkPrimitive") as HostComponent<NativeProps>;
