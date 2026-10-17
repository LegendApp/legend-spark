import type { HostComponent, ViewProps } from "react-native";
import type { DirectEventHandler, Float, WithDefault } from "react-native/Libraries/Types/CodegenTypes";
import codegenNativeComponent from "react-native/Libraries/Utilities/codegenNativeComponent";

/** Private: AppleSignInButton (apple.ts) is the public component and validates these. */
export interface NativeProps extends ViewProps {
  buttonType?: WithDefault<"signIn" | "continue" | "signUp", "signIn">;
  buttonStyle?: WithDefault<"automatic" | "black" | "white" | "whiteOutline", "automatic">;
  /** Points; negative keeps the system's corner radius. */
  cornerRadius?: WithDefault<Float, -1>;
  /** `windowId`: the button's Spark window ("main", or a window's id), empty for a window Spark did not make. */
  onButtonPress?: DirectEventHandler<Readonly<{ windowId: string }>>;
}
export default codegenNativeComponent<NativeProps>("DesktopAppleSignInButton") as HostComponent<NativeProps>;
