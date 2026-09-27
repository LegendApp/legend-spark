import type { HostComponent, ViewProps } from "react-native";
import type { DirectEventHandler, WithDefault, Int32 } from "react-native/Libraries/Types/CodegenTypes";
import codegenNativeComponent from "react-native/Libraries/Utilities/codegenNativeComponent";
export interface NativeProps extends ViewProps {
  onUnavailable?: DirectEventHandler<Readonly<{ message: string }>>;
  itemsJson: string;
  disabled?: WithDefault<boolean, false>;
  selectionRevision?: Int32;
  value: string;
  onSelectionChange?: DirectEventHandler<Readonly<{ value: string }>>;
}
export default codegenNativeComponent<NativeProps>("SparkSelect") as HostComponent<NativeProps>;
