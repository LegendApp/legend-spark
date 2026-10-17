import type { HostComponent, ViewProps } from "react-native";
import type { DirectEventHandler, Int32, WithDefault } from "react-native/Libraries/Types/CodegenTypes";
import codegenNativeCommands from "react-native/Libraries/Utilities/codegenNativeCommands";
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
  onPromisedFileWrite?: DirectEventHandler<Payload>;
  onSpringLoad?: DirectEventHandler<Payload>;
  onSpringLoadHighlight?: DirectEventHandler<Payload>;
  onTearOff?: DirectEventHandler<Payload>;
}
type NativeComponentType = HostComponent<NativeProps>;
export interface NativeCommands {
  /** Answers onPromisedFileWrite: an empty error when the file is written. */
  completePromisedFile: (viewRef: React.ElementRef<NativeComponentType>, requestId: Int32, error: string) => void;
}
export const Commands = codegenNativeCommands<NativeCommands>({ supportedCommands: ["completePromisedFile"] });
export default codegenNativeComponent<NativeProps>("DesktopDragView") as NativeComponentType;
