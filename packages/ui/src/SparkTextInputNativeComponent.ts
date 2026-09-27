import type { HostComponent, ViewProps } from "react-native";
import type { DirectEventHandler, WithDefault, Int32 } from "react-native/Libraries/Types/CodegenTypes";
import codegenNativeComponent from "react-native/Libraries/Utilities/codegenNativeComponent";
export interface NativeProps extends ViewProps {
  onUnavailable?: DirectEventHandler<Readonly<{ message: string }>>;
  defaultText?: string;
  text?: string;
  controlled?: WithDefault<boolean, false>;
  disabled?: WithDefault<boolean, false>;
  eventCount?: Int32;
  onTextChange?: DirectEventHandler<Readonly<{ text: string; eventCount: Int32 }>>;
}
export default codegenNativeComponent<NativeProps>("SparkTextInput") as HostComponent<NativeProps>;
