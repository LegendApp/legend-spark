import type { CodegenTypes, HostComponent, ViewProps } from "react-native";
import { codegenNativeComponent } from "react-native";

export type SidebarItemRightClickEvent = Readonly<{
  altKey: boolean;
  button: CodegenTypes.Double;
  ctrlKey: boolean;
  metaKey: boolean;
  pageX: CodegenTypes.Double;
  pageY: CodegenTypes.Double;
  shiftKey: boolean;
  x: CodegenTypes.Double;
  y: CodegenTypes.Double;
}>;

export interface NativeProps extends ViewProps {
  autoHeight?: boolean;
  itemId?: string;
  onRightClick?: CodegenTypes.DirectEventHandler<SidebarItemRightClickEvent>;
  rowHeight?: CodegenTypes.Double;
  selectable?: boolean;
}

export default codegenNativeComponent<NativeProps>("SidebarItem") as HostComponent<NativeProps>;
