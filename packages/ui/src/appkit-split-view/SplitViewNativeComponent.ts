import { codegenNativeComponent, type CodegenTypes, type HostComponent, type ViewProps } from "react-native";

type PaneSizing = Readonly<{
  id: string;
  initialSize: CodegenTypes.Double;
  minSize: CodegenTypes.Double;
  maxSize: CodegenTypes.Double;
}>;

export type SplitViewLayoutEvent = Readonly<{
  horizontal: boolean;
  rightToLeft: boolean;
  panes: {
    id: string;
    x: CodegenTypes.Double;
    y: CodegenTypes.Double;
    width: CodegenTypes.Double;
    height: CodegenTypes.Double;
  }[];
}>;

export interface NativeProps extends ViewProps {
  horizontal?: CodegenTypes.WithDefault<boolean, true>;
  dividerStyle?: string;
  panes?: ReadonlyArray<PaneSizing>;
  onSplitViewLayout?: CodegenTypes.DirectEventHandler<SplitViewLayoutEvent>;
}

export default codegenNativeComponent<NativeProps>("SparkSplitView") as HostComponent<NativeProps>;
