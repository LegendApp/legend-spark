import type { HostComponent, ViewProps } from "react-native";
import { codegenNativeComponent } from "react-native";
import type { DirectEventHandler } from "react-native/Libraries/Types/CodegenTypes";

export interface NativeProps extends ViewProps {
  leadingActionsJson: string;
  trailingActionsJson: string;
  onSwipeAction?: DirectEventHandler<Readonly<{ actionId: string }>>;
}

export default codegenNativeComponent<NativeProps>("SwipeActions") as HostComponent<NativeProps>;
