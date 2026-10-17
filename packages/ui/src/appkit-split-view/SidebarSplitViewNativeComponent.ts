import type { HostComponent, ViewProps } from "react-native";
import { codegenNativeComponent } from "react-native";
import type { DirectEventHandler, Double } from "react-native/Libraries/Types/CodegenTypes";

export type SidebarSplitViewResizeEvent = Readonly<{
  contentHeight: Double;
  contentWidth: Double;
  contentX: Double;
  height: Double;
  isLayoutReady: boolean;
  isVertical: boolean;
  listHeight: Double;
  listWidth: Double;
  listX: Double;
  sidebarHeight: Double;
  sidebarWidth: Double;
}>;

export type SidebarSplitViewCollapsedChangeEvent = Readonly<{
  collapsed: boolean;
}>;

export interface NativeProps extends ViewProps {
  appearance?: string;
  contentTitlebarHeight?: Double;
  contentTitlebarMaterial?: string;
  contentTitlebarOverlayColor?: string;
  contentTitlebarOverlayOpacity?: Double;
  contentMinWidth?: Double;
  hasList?: boolean;
  listMinWidth?: Double;
  listWidth?: Double;
  onSidebarCollapsedChange?: DirectEventHandler<SidebarSplitViewCollapsedChangeEvent>;
  onSplitViewDidResize?: DirectEventHandler<SidebarSplitViewResizeEvent>;
  sidebarCollapsed?: boolean;
  sidebarMinWidth?: Double;
  sidebarTitlebarOverlayColor?: string;
  sidebarTitlebarOverlayOpacity?: Double;
  sidebarWidth?: Double;
}

export default codegenNativeComponent<NativeProps>("SidebarSplitView") as HostComponent<NativeProps>;
