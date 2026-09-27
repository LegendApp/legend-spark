import type { HostComponent, ViewProps } from "react-native";
import { codegenNativeComponent } from "react-native";
import codegenNativeCommands from "react-native/Libraries/Utilities/codegenNativeCommands";
import type { DirectEventHandler, Int32, WithDefault } from "react-native/Libraries/Types/CodegenTypes";

export type TextInputSearchChangeEvent = {
  text: string;
  eventCount: Int32;
};

export interface NativeProps extends ViewProps {
  appearance?: string;
  defaultText?: string;
  controlled?: WithDefault<boolean, false>;
  disabled?: WithDefault<boolean, false>;
  eventCount?: Int32;
  onChangeText?: DirectEventHandler<TextInputSearchChangeEvent>;
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
