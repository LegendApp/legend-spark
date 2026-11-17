import type { CodegenTypes, HostComponent, ViewProps } from "react-native";
import { codegenNativeComponent } from "react-native";

export interface NativeProps extends ViewProps {
  /** JSON array of `{ label, value }`. */
  itemsJson: string;
  value: string;
  /** Re-applies `value` when it changes, so a click the app does not accept snaps back. */
  selectionRevision?: CodegenTypes.Int32;
  enabled?: CodegenTypes.WithDefault<boolean, true>;
  orientation?: CodegenTypes.WithDefault<"vertical" | "horizontal", "vertical">;
  controlSize?: CodegenTypes.WithDefault<"regular" | "small" | "mini", "regular">;
  onValueChange?: CodegenTypes.DirectEventHandler<Readonly<{ value: string }>>;
  onIntrinsicSize?: CodegenTypes.DirectEventHandler<Readonly<{ width: CodegenTypes.Double; height: CodegenTypes.Double }>>;
}

export default codegenNativeComponent<NativeProps>("SparkRadioGroup") as HostComponent<NativeProps>;
