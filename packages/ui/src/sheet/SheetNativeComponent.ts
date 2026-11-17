import type { CodegenTypes, HostComponent, ViewProps } from "react-native";
import { codegenNativeComponent } from "react-native";

export interface NativeProps extends ViewProps {
  /** Shown once the content has a size. The child is the content; it is hosted in a sheet on this view's window. */
  visible?: CodegenTypes.WithDefault<boolean, false>;
  contentWidth?: CodegenTypes.Double;
  contentHeight?: CodegenTypes.Double;
  /** Escape or ⌘. in the sheet. */
  onCancel?: CodegenTypes.DirectEventHandler<Readonly<{}>>;
  /** Sent while `visible` is false and content is still mounted (after the close animation if the sheet was open); the content may unmount. */
  onDismiss?: CodegenTypes.DirectEventHandler<Readonly<{}>>;
}

export default codegenNativeComponent<NativeProps>("SparkSheet") as HostComponent<NativeProps>;
