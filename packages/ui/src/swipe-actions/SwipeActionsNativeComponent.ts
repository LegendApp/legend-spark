import type { CodegenTypes, HostComponent, ViewProps } from "react-native";
import { codegenNativeComponent } from "react-native";

export interface NativeProps extends ViewProps {
  leadingActionsJson: string;
  trailingActionsJson: string;
  onSwipeAction?: CodegenTypes.DirectEventHandler<Readonly<{ actionId: string }>>;
}

export default codegenNativeComponent<NativeProps>("SwipeActions") as HostComponent<NativeProps>;
