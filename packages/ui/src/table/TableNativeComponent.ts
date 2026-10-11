import type { HostComponent, ViewProps } from "react-native";
import { codegenNativeComponent } from "react-native";
import type { DirectEventHandler, Double, Int32 } from "react-native/Libraries/Types/CodegenTypes";

export interface NativeProps extends ViewProps {
  /** NSOutlineView when true, NSTableView otherwise. */
  outline: boolean;
  columnsJson: string;
  /** JSON arrays of `[depth, expandable, {id, cells}]`; native re-parses only chunks whose text changed. */
  rowChunks: ReadonlyArray<string>;
  selectionMode: string;
  selectedIds: ReadonlyArray<string>;
  expandedIds: ReadonlyArray<string>;
  /** `[{columnId, ascending}]`. */
  sortJson: string;
  /** `[{id, width}]` in display order, or "" when native owns the column layout. */
  columnLayoutJson: string;
  columnReordering: boolean;
  /** The latest native event count JS has processed; native reconciles controlled state only when caught up. */
  eventCount: Int32;
  onTableSelectionChange?: DirectEventHandler<Readonly<{ ids: string[]; eventCount: Int32 }>>;
  onTableExpandedChange?: DirectEventHandler<Readonly<{ ids: string[]; eventCount: Int32 }>>;
  onTableSortChange?: DirectEventHandler<Readonly<{ sortJson: string; eventCount: Int32 }>>;
  onTableColumnLayoutChange?: DirectEventHandler<Readonly<{ layoutJson: string; eventCount: Int32 }>>;
  onTableActivate?: DirectEventHandler<Readonly<{ ids: string[] }>>;
  /** `rowId` is "" outside any row; x and y are logical points from the window content's top-left. */
  onTableContextMenu?: DirectEventHandler<Readonly<{ ids: string[]; rowId: string; x: Double; y: Double }>>;
  /** Row or configuration JSON that native could not read. */
  onTableError?: DirectEventHandler<Readonly<{ message: string }>>;
}

export default codegenNativeComponent<NativeProps>("SparkTable") as HostComponent<NativeProps>;
