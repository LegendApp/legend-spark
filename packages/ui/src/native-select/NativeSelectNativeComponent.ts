import type { CodegenTypes, HostComponent, ViewProps } from "react-native";
import { codegenNativeComponent } from "react-native";

export type NativeSelectChangeEvent = {
  value: string;
};

export interface NativeProps extends ViewProps {
  enabled?: boolean;
  selectionRevision?: CodegenTypes.Int32;
  itemsJson: string;
  onValueChange?: CodegenTypes.DirectEventHandler<NativeSelectChangeEvent>;
  value: string;
}

export default codegenNativeComponent<NativeProps>("NativeSelect") as HostComponent<NativeProps>;
