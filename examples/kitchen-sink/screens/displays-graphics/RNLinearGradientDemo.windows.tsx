import { Text } from "react-native";

export function RNLinearGradientDemo() {
  return <Text selectable testID="displays-graphics-rn-linear-gradient-unsupported" style={{ padding: 24 }}>react-native-linear-gradient is not supported on Windows yet: its Windows view is a legacy XAML view manager, which React Native Windows' new architecture can't host. Gradients are unavailable through it on Windows.</Text>;
}
