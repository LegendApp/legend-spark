import type { HostComponent, ViewProps } from "react-native";
import codegenNativeComponent from "react-native/Libraries/Utilities/codegenNativeComponent";

/** Private: CameraView (capture.tsx) is the public component. */
export interface NativeProps extends ViewProps {
  /** The running camera session to show; empty shows nothing. */
  sessionId?: string;
  /** contain (the default when empty), cover or fill; validated by CameraView. */
  contentFit?: string;
}
export default codegenNativeComponent<NativeProps>("DesktopCameraView") as HostComponent<NativeProps>;
