import type { HostComponent, ViewProps } from "react-native";
import codegenNativeComponent from "react-native/Libraries/Utilities/codegenNativeComponent";

/** Private: VideoView (video.tsx) is the public component. */
export interface NativeProps extends ViewProps {
  /** The SparkVideoPlayer to show; empty shows nothing. */
  playerId?: string;
  /** contain (the default when empty), cover or fill; validated by VideoView. */
  contentFit?: string;
}
export default codegenNativeComponent<NativeProps>("DesktopVideoView") as HostComponent<NativeProps>;
