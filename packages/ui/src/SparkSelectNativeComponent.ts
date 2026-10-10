import type { CodegenTypes, HostComponent, ViewProps } from "react-native";
import { codegenNativeComponent } from "react-native";
export interface NativeProps extends ViewProps {
  onUnavailable?: CodegenTypes.DirectEventHandler<Readonly<{ message: string }>>;
  itemsJson: string;
  disabled?: CodegenTypes.WithDefault<boolean, false>;
  selectionRevision?: CodegenTypes.Int32;
  value: string;
  onSelectionChange?: CodegenTypes.DirectEventHandler<Readonly<{ value: string }>>;
}
export default codegenNativeComponent<NativeProps>("SparkSelect") as HostComponent<NativeProps>;
