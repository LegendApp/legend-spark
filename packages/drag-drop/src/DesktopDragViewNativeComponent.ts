import type { HostComponent, ViewProps } from "react-native";
import type { DirectEventHandler, WithDefault } from "react-native/Libraries/Types/CodegenTypes";
import codegenNativeComponent from "react-native/Libraries/Utilities/codegenNativeComponent";
type Payload = Readonly<{ json: string }>;
export interface NativeProps extends ViewProps {
  sourceJson?: string;
  optionsJson?: string;
  disabled?: WithDefault<boolean, false>;
  onError?: DirectEventHandler<Payload>;
  onDrop?: DirectEventHandler<Payload>;
  onDragEnter?: DirectEventHandler<Payload>;
  onDragOver?: DirectEventHandler<Payload>;
  onDragLeave?: DirectEventHandler<Payload>;
  onDragEnd?: DirectEventHandler<Payload>;
}
export default codegenNativeComponent<NativeProps>("DesktopDragView") as HostComponent<NativeProps>;
