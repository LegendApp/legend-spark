import type { CodegenTypes, HostComponent, ViewProps } from "react-native";
import { codegenNativeComponent } from "react-native";

export type SidebarSplitViewResizeEvent = Readonly<{
  contentHeight: CodegenTypes.Double;
  contentWidth: CodegenTypes.Double;
  contentX: CodegenTypes.Double;
  height: CodegenTypes.Double;
  isLayoutReady: boolean;
  isVertical: boolean;
  listHeight: CodegenTypes.Double;
  listWidth: CodegenTypes.Double;
  listX: CodegenTypes.Double;
  sidebarHeight: CodegenTypes.Double;
  sidebarWidth: CodegenTypes.Double;
}>;

export interface NativeProps extends ViewProps {
  appearance?: string;
  contentTitlebarHeight?: CodegenTypes.Double;
  contentTitlebarMaterial?: string;
  contentTitlebarOverlayColor?: string;
  contentTitlebarOverlayOpacity?: CodegenTypes.Double;
  contentMinWidth?: CodegenTypes.Double;
  hasList?: boolean;
  listMinWidth?: CodegenTypes.Double;
  listWidth?: CodegenTypes.Double;
  onSplitViewDidResize?: CodegenTypes.DirectEventHandler<SidebarSplitViewResizeEvent>;
  sidebarCollapsed?: boolean;
  sidebarMinWidth?: CodegenTypes.Double;
  sidebarTitlebarOverlayColor?: string;
  sidebarTitlebarOverlayOpacity?: CodegenTypes.Double;
  sidebarWidth?: CodegenTypes.Double;
}

export default codegenNativeComponent<NativeProps>("SidebarSplitView") as HostComponent<NativeProps>;
