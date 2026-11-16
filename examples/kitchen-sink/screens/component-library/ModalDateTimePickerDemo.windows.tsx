import { Text } from "react-native";

export function ModalDateTimePickerDemo() {
  return <Text selectable testID="component-library-modal-datetime-picker-unsupported" style={{ padding: 24 }}>react-native-modal-datetime-picker is not supported on Windows: it wraps @react-native-community/datetimepicker, which has no Windows implementation in Spark yet, so its picker never shows and upstream only logs a warning.</Text>;
}
