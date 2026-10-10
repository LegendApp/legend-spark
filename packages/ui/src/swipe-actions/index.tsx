import { View, type NativeSyntheticEvent } from "react-native";
import { SparkError } from "@legendapp/spark-desktop-app/src/contracts";
import { useControl } from "../control";
import { callback, identifier, macosViewAvailability, type SpecializedViewProps } from "../specialized";
import NativeSwipeActions from "./SwipeActionsNativeComponent";
/** `dismisses` slides the row away on commit (archive, delete); otherwise it springs back (snooze, flag). */
export interface SwipeAction { id: string; title: string; symbol: string; color: string; dismisses?: boolean }
export interface SwipeActionsProps extends SpecializedViewProps {
  /** Revealed by swiping right; the first action is outermost and runs on a full swipe. */
  leadingActions?: readonly SwipeAction[];
  /** Revealed by swiping left; the first action is outermost and runs on a full swipe. */
  trailingActions?: readonly SwipeAction[];
  onAction: (id: string) => void;
}
const hexColor = /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i;
function actionsJson(actions: readonly SwipeAction[], ids: Set<string>) {
  for (const action of actions) {
    identifier(action?.id, "swipe action ID"); identifier(action.title, "swipe action title"); identifier(action.symbol, "swipe action symbol");
    if (typeof action.color !== "string" || !hexColor.test(action.color)) throw new SparkError("E_INVALID_ARGUMENT", "Swipe action colors are #RRGGBB or #RRGGBBAA");
    if (action.dismisses !== undefined && typeof action.dismisses !== "boolean") throw new SparkError("E_INVALID_ARGUMENT", "Invalid swipe action dismisses");
    if (ids.has(action.id)) throw new SparkError("E_INVALID_ARGUMENT", "Duplicate swipe action ID");
    ids.add(action.id);
  }
  return JSON.stringify(actions.map(({ id, title, symbol, color, dismisses = false }) => ({ id, title, symbol, color, dismisses })));
}
export function getSwipeActionsAvailability() { return macosViewAvailability("SwipeActions"); }
/** Native trackpad swipe actions for one row; children keep their own layout and presses. */
export function SwipeActions({ leadingActions = [], trailingActions = [], onAction, ref, onError, ...props }: SwipeActionsProps) {
  callback(onAction, "swipe action");
  const ids = new Set<string>(), leading = actionsJson(leadingActions, ids), trailing = actionsJson(trailingActions, ids);
  const control = useControl({ ref, onError }, getSwipeActionsAvailability());
  function action(event: NativeSyntheticEvent<{ actionId: string }>) {
    if (!control.active()) return;
    const id = event?.nativeEvent?.actionId;
    if (typeof id !== "string" || !ids.has(id)) { control.error(new SparkError("E_INVALID_DATA", "Invalid swipe action")); return; }
    onAction(id);
  }
  if (control.failed) return <View {...props} ref={control.ref} />;
  return <NativeSwipeActions {...props} ref={control.ref} leadingActionsJson={leading} trailingActionsJson={trailing} onSwipeAction={action} />;
}
