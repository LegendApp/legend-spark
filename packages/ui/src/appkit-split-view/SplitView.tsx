import { useMemo, useRef, useState, type ReactNode } from "react";
import { View, type NativeSyntheticEvent } from "react-native";
import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import { useControl } from "../control";
import { callback, finite, identifier, macosViewAvailability, type SpecializedViewProps } from "../specialized";
import NativeSplitView, { type SplitViewLayoutEvent } from "./SplitViewNativeComponent";

export interface SplitViewPane {
  id: string;
  content: ReactNode;
  initialSize?: number;
  minSize?: number;
  maxSize?: number;
}

export interface SplitViewProps extends Omit<SpecializedViewProps, "children"> {
  panes: readonly SplitViewPane[];
  children?: never;
  orientation?: "horizontal" | "vertical";
  dividerStyle?: "thin" | "thick" | "paneSplitter";
  onResize?: (sizes: readonly number[]) => void;
}

function matches(layout: SplitViewLayoutEvent, horizontal: boolean, panes: readonly { id: string }[]) {
  return layout.horizontal === horizontal
    && layout.panes.length === panes.length
    && layout.panes.every((frame, index) => frame.id === panes[index].id);
}

export function SplitView({ panes, children, orientation = "horizontal", dividerStyle = "thin", onResize, onError, ref, ...props }: SplitViewProps) {
  if (children !== undefined) throw new SparkError("E_INVALID_ARGUMENT", "Pass split-view content through panes");
  if (orientation !== "horizontal" && orientation !== "vertical") throw new SparkError("E_INVALID_ARGUMENT", "Invalid split-view orientation");
  if (!["thin", "thick", "paneSplitter"].includes(dividerStyle)) throw new SparkError("E_INVALID_ARGUMENT", "Invalid split-view divider style");
  callback(onResize, "resize");
  const sizing = useMemo(() => {
    if (!Array.isArray(panes)) throw new SparkError("E_INVALID_ARGUMENT", "Expected split-view panes");
    const ids = new Set<string>();
    return Array.from(panes as readonly SplitViewPane[], pane => {
      if (!pane || typeof pane !== "object") throw new SparkError("E_INVALID_ARGUMENT", "Invalid split-view pane");
      const { id, minSize = 0, maxSize, initialSize } = pane;
      identifier(id, "split-view pane ID");
      if (ids.has(id)) throw new SparkError("E_INVALID_ARGUMENT", `Duplicate split-view pane ID: ${id}`);
      ids.add(id);
      finite(minSize, "minimum pane size");
      if (maxSize !== undefined) finite(maxSize, "maximum pane size", minSize);
      if (initialSize !== undefined) finite(initialSize, "initial pane size", minSize, maxSize);
      return { id, minSize, maxSize: maxSize ?? -1, initialSize: initialSize ?? -1 };
    });
  }, [panes]);
  const control = useControl({ onError, ref }, macosViewAvailability("SparkSplitView"));
  const horizontal = orientation === "horizontal";
  const [layout, setLayout] = useState<SplitViewLayoutEvent>();
  const reported = useRef<{ layout: SplitViewLayoutEvent; sizes: readonly number[] } | undefined>(undefined);

  function resize({ nativeEvent }: NativeSyntheticEvent<SplitViewLayoutEvent>) {
    if (!control.active()) return;
    try {
      if (typeof nativeEvent?.horizontal !== "boolean" || typeof nativeEvent.rightToLeft !== "boolean" || !Array.isArray(nativeEvent.panes)) throw new Error("Expected pane frames");
      for (const { id, x, y, width, height } of nativeEvent.panes) {
        identifier(id);
        finite(x, "pane x"); finite(y, "pane y"); finite(width, "pane width"); finite(height, "pane height");
      }
    } catch (cause) {
      control.error(new SparkError("E_INVALID_DATA", "Invalid split-view layout", { cause }));
      return;
    }
    if (!matches(nativeEvent, horizontal, sizing)) return;
    setLayout(nativeEvent);
    if (!onResize) return;
    const sizes = nativeEvent.panes.map(frame => horizontal ? frame.width : frame.height);
    const last = reported.current;
    if (!last || !matches(last.layout, horizontal, sizing) || sizes.some((size, index) => size !== last.sizes[index])) {
      reported.current = { layout: nativeEvent, sizes };
      onResize(sizes);
    }
  }

  if (control.failed) {
    return <View {...props} ref={control.ref} style={[{ flexDirection: horizontal ? "row" : "column" }, props.style]}>
      {panes.map(({ id, content, initialSize, minSize, maxSize }) => <View key={id} style={horizontal
        ? { flexBasis: initialSize ?? 0, flexGrow: 1, flexShrink: 1, minWidth: minSize, maxWidth: maxSize }
        : { flexBasis: initialSize ?? 0, flexGrow: 1, flexShrink: 1, minHeight: minSize, maxHeight: maxSize }}>{content}</View>)}
    </View>;
  }

  const current = layout && matches(layout, horizontal, sizing) ? layout : undefined;
  return <NativeSplitView {...props} ref={control.ref} horizontal={horizontal} dividerStyle={dividerStyle} panes={sizing} onSplitViewLayout={resize}>
    {panes.map(({ id, content }, index) => {
      const frame = current?.panes[index];
      return <View key={id} collapsable={false} style={{
        position: "absolute",
        [current?.rightToLeft ? "end" : "start"]: frame?.x ?? 0,
        top: frame?.y ?? 0,
        width: frame?.width ?? 0,
        height: frame?.height ?? 0,
      }}>{content}</View>;
    })}
  </NativeSplitView>;
}
