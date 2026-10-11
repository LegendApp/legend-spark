import type { HostComponent, ViewProps } from "react-native";
import { codegenNativeComponent } from "react-native";

export interface NativeProps extends ViewProps {
  tabId: string;
  label: string;
}

export default codegenNativeComponent<NativeProps>("SparkTab") as HostComponent<NativeProps>;
