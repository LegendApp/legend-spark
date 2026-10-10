import type { CodegenTypes, HostComponent, ViewProps } from "react-native";
import { codegenNativeComponent } from "react-native";

export type SidebarSelectionChangeEvent = Readonly<{
  id: string;
}>;

export type SidebarLayoutEvent = Readonly<{
  height: CodegenTypes.Double;
  width: CodegenTypes.Double;
}>;

export interface NativeProps extends ViewProps {
  contentInsetTop?: CodegenTypes.Double;
  defaultRowHeight?: CodegenTypes.Double;
  itemsJson?: string;
  onSidebarLayout?: CodegenTypes.DirectEventHandler<SidebarLayoutEvent>;
  onSidebarSelectionChange?: CodegenTypes.DirectEventHandler<SidebarSelectionChangeEvent>;
  selectedId?: string;
  selectionRevision?: CodegenTypes.Int32;
}

export default codegenNativeComponent<NativeProps>("Sidebar") as HostComponent<NativeProps>;
