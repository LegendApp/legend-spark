import type { CodegenTypes, HostComponent, ViewProps } from "react-native";
import { codegenNativeComponent } from "react-native";
export interface NativeProps extends ViewProps {
  onUnavailable?: CodegenTypes.DirectEventHandler<Readonly<{ message: string }>>;
  defaultText?: string;
  text?: string;
  controlled?: CodegenTypes.WithDefault<boolean, false>;
  disabled?: CodegenTypes.WithDefault<boolean, false>;
  eventCount?: CodegenTypes.Int32;
  onTextChange?: CodegenTypes.DirectEventHandler<Readonly<{ text: string; eventCount: CodegenTypes.Int32 }>>;
}
export default codegenNativeComponent<NativeProps>("SparkTextInput") as HostComponent<NativeProps>;
