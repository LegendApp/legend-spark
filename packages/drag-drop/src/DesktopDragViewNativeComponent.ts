import type { CodegenTypes, HostComponent, ViewProps } from "react-native";
import { codegenNativeComponent } from "react-native";
type Payload = Readonly<{ json: string }>;
export interface NativeProps extends ViewProps {
  sourceJson?: string;
  optionsJson?: string;
  disabled?: CodegenTypes.WithDefault<boolean, false>;
  onError?: CodegenTypes.DirectEventHandler<Payload>;
  onDrop?: CodegenTypes.DirectEventHandler<Payload>;
  onDragEnter?: CodegenTypes.DirectEventHandler<Payload>;
  onDragOver?: CodegenTypes.DirectEventHandler<Payload>;
  onDragLeave?: CodegenTypes.DirectEventHandler<Payload>;
  onDragEnd?: CodegenTypes.DirectEventHandler<Payload>;
}
export default codegenNativeComponent<NativeProps>("DesktopDragView") as HostComponent<NativeProps>;
