import type { HostComponent, ViewProps } from "react-native";
import { codegenNativeComponent } from "react-native";
import type { DirectEventHandler, Double, Int32, WithDefault } from "react-native/Libraries/Types/CodegenTypes";

export type SidebarSelectionChangeEvent = Readonly<{
  id: string;
  idsJson: string;
}>;

export type SidebarExpandedChangeEvent = Readonly<{
  expanded: boolean;
  id: string;
}>;

export type SidebarDoubleClickEvent = Readonly<{
  id: string;
}>;

export type SidebarLayoutEvent = Readonly<{
  height: Double;
  width: Double;
}>;

export type SidebarRowLayoutEvent = Readonly<{
  width: Double;
}>;

export interface NativeProps extends ViewProps {
  allowsMultipleSelection?: boolean;
  collapsedIdsJson?: string;
  contentInsetTop?: Double;
  defaultRowHeight?: Double;
  itemsJson?: string;
  listStyle?: WithDefault<"sidebar" | "plain", "sidebar">;
  onSidebarDoubleClick?: DirectEventHandler<SidebarDoubleClickEvent>;
  onSidebarExpandedChange?: DirectEventHandler<SidebarExpandedChangeEvent>;
  onSidebarLayout?: DirectEventHandler<SidebarLayoutEvent>;
  onSidebarRowLayout?: DirectEventHandler<SidebarRowLayoutEvent>;
  onSidebarSelectionChange?: DirectEventHandler<SidebarSelectionChangeEvent>;
  selectedIdsJson?: string;
  selectionRevision?: Int32;
}

export default codegenNativeComponent<NativeProps>("Sidebar") as HostComponent<NativeProps>;
