import type { HostComponent, ViewProps } from "react-native";
import { codegenNativeComponent } from "react-native";
import type { DirectEventHandler, Double, Int32 } from "react-native/Libraries/Types/CodegenTypes";

export interface NativeProps extends ViewProps {
  selectedId: string;
  /** The latest native event count JS has processed; native reconciles `selectedId` only when caught up. */
  eventCount: Int32;
  tabPosition: string;
  tabBorder: string;
  onTabViewSelectionChange?: DirectEventHandler<Readonly<{ eventCount: Int32; id: string }>>;
  /** The size of the content area inside the tabs and border. */
  onTabViewContentLayout?: DirectEventHandler<Readonly<{ height: Double; width: Double }>>;
}

export default codegenNativeComponent<NativeProps>("SparkTabView") as HostComponent<NativeProps>;
