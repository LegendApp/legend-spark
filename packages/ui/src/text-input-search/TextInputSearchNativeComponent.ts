import type { CodegenTypes, HostComponent, ViewProps } from "react-native";
import { codegenNativeComponent, codegenNativeCommands } from "react-native";

export type TextInputSearchChangeEvent = {
  text: string;
  eventCount: CodegenTypes.Int32;
};

export interface NativeProps extends ViewProps {
  appearance?: string;
  defaultText?: string;
  controlled?: CodegenTypes.WithDefault<boolean, false>;
  disabled?: CodegenTypes.WithDefault<boolean, false>;
  eventCount?: CodegenTypes.Int32;
  onChangeText?: CodegenTypes.DirectEventHandler<TextInputSearchChangeEvent>;
  placeholder?: string;
  text?: string;
}

type NativeComponentType = HostComponent<NativeProps>;

export interface NativeCommands {
  focus: (viewRef: React.ElementRef<NativeComponentType>) => void;
  blur: (viewRef: React.ElementRef<NativeComponentType>) => void;
}

export const Commands = codegenNativeCommands<NativeCommands>({
  supportedCommands: ["focus", "blur"],
});

export default codegenNativeComponent<NativeProps>("TextInputSearch") as NativeComponentType;
