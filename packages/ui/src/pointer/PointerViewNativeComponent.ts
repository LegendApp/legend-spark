import type { HostComponent, ViewProps } from "react-native";
import { codegenNativeComponent } from "react-native";
import type { DirectEventHandler, Double, Int32 } from "react-native/Libraries/Types/CodegenTypes";

export interface NativeProps extends ViewProps {
  /** Empty without a custom cursor; else `symbol` or `image`, with the symbol name or image path in `cursorName`. */
  cursorType: string;
  cursorName: string;
  cursorPointSize: Double;
  cursorHasHotSpot: boolean;
  cursorHotSpotX: Double;
  cursorHotSpotY: Double;
  /** Event types JS handles; native passes the others up the responder chain. */
  handledEvents: ReadonlyArray<string>;
  /** One event per pointer input; fields that do not apply to `type` are zero or empty. */
  onPointerInput?: DirectEventHandler<Readonly<{
    type: string; x: Double; y: Double; magnification: Double; rotation: Double; phase: string; direction: string;
    pressure: Double; stage: Int32; stageTransition: Double; button: string;
  }>>;
  onPointerViewError?: DirectEventHandler<Readonly<{ code: string; message: string }>>;
}

export default codegenNativeComponent<NativeProps>("SparkPointerView") as HostComponent<NativeProps>;
