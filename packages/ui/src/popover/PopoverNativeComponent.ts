import type { HostComponent, ViewProps } from "react-native";
import { codegenNativeComponent } from "react-native";
import type { DirectEventHandler, Double, Int32 } from "react-native/Libraries/Types/CodegenTypes";

export interface NativeProps extends ViewProps {
  open: boolean;
  /** The latest native event count JS has processed; native reconciles `open` only when caught up. */
  eventCount: Int32;
  behavior: string;
  preferredEdge: string;
  detachable: boolean;
  /** React tag of the anchor view; 0 anchors to the window content, -1 while a ref is unresolved. */
  anchorTag: Int32;
  hasAnchorRect: boolean;
  anchorX: Double;
  anchorY: Double;
  anchorWidth: Double;
  anchorHeight: Double;
  /** `shown`, `closed` or `detached`; every event is counted. */
  onPopoverChange?: DirectEventHandler<Readonly<{ eventCount: Int32; state: string }>>;
  onPopoverError?: DirectEventHandler<Readonly<{ code: string; message: string }>>;
}

export default codegenNativeComponent<NativeProps>("SparkPopover") as HostComponent<NativeProps>;
