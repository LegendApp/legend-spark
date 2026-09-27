import type { HostComponent, ViewProps } from "react-native";
import { codegenNativeComponent } from "react-native";
import type { DirectEventHandler, Int32 } from "react-native/Libraries/Types/CodegenTypes";

export type NativeSegmentedControlChangeEvent = {
  value: string;
};

export interface NativeProps extends ViewProps {
  enabled?: boolean;
  selectionRevision?: Int32;
  segmentsJson: string;
  onValueChange?: DirectEventHandler<NativeSegmentedControlChangeEvent>;
  value: string;
}

export default codegenNativeComponent<NativeProps>("NativeSegmentedControl") as HostComponent<NativeProps>;
