import type { CodegenTypes, HostComponent, ViewProps } from "react-native";
import { codegenNativeComponent } from "react-native";

export type NativeSegmentedControlChangeEvent = {
  value: string;
};

export interface NativeProps extends ViewProps {
  enabled?: boolean;
  selectionRevision?: CodegenTypes.Int32;
  segmentsJson: string;
  onValueChange?: CodegenTypes.DirectEventHandler<NativeSegmentedControlChangeEvent>;
  value: string;
}

export default codegenNativeComponent<NativeProps>("NativeSegmentedControl") as HostComponent<NativeProps>;
