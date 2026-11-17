import type { CodegenTypes, HostComponent, ViewProps } from "react-native";
import { codegenNativeComponent } from "react-native";

export interface NativeProps extends ViewProps {
  /** [{ id, title, width?, minWidth?, maxWidth?, alignment?, monospacedDigits?, secondary? }] */
  columnsJson?: string;
  /** [{ id, values: { [columnId]: string } }] */
  rowsJson?: string;
  selectedIdsJson?: string;
  /** Changes after each native selection so the parent's `selectedIdsJson` is re-applied even when unchanged. */
  selectionRevision?: CodegenTypes.Int32;
  allowsMultipleSelection?: CodegenTypes.WithDefault<boolean, false>;
  headerVisible?: CodegenTypes.WithDefault<boolean, true>;
  alternatingRows?: CodegenTypes.WithDefault<boolean, false>;
  rowHeight?: CodegenTypes.Double;
  onTableSelectionChange?: CodegenTypes.DirectEventHandler<Readonly<{ id: string; idsJson: string }>>;
  onTableDoubleClick?: CodegenTypes.DirectEventHandler<Readonly<{ id: string }>>;
}

export default codegenNativeComponent<NativeProps>("SparkTable") as HostComponent<NativeProps>;
