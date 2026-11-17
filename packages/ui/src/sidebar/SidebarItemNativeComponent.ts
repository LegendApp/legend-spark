import type { HostComponent, ViewProps } from "react-native";
import { codegenNativeComponent } from "react-native";
import type { DirectEventHandler, Double, Int32, WithDefault } from "react-native/Libraries/Types/CodegenTypes";

export type SidebarItemRightClickEvent = Readonly<{
  altKey: boolean;
  button: Double;
  ctrlKey: boolean;
  metaKey: boolean;
  pageX: Double;
  pageY: Double;
  shiftKey: boolean;
  x: Double;
  y: Double;
}>;

export type SidebarItemLayoutEvent = Readonly<{
  width: Double;
}>;

export interface NativeProps extends ViewProps {
  autoHeight?: boolean;
  count?: WithDefault<Int32, -1>;
  group?: boolean;
  itemId?: string;
  onRightClick?: DirectEventHandler<SidebarItemRightClickEvent>;
  onSidebarItemLayout?: DirectEventHandler<SidebarItemLayoutEvent>;
  parentId?: string;
  rowHeight?: Double;
  selectable?: boolean;
}

export default codegenNativeComponent<NativeProps>("SidebarItem") as HostComponent<NativeProps>;
