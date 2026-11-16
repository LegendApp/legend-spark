import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import Toast from "react-native-toast-message";

// Test IDs: the screen shows a toast on mount; -shown once onShow fires. The button shows another.
const ID = "component-library-toast-message";

/** react-native-toast-message: Toast.show() slides a success toast in from the top. */
export function ToastMessageDemo() {
  const [shown, setShown] = useState(0);
  const show = () => Toast.show({ type: "success", text1: "Saved", text2: "The toast came from react-native-toast-message", onShow: () => setShown(count => count + 1) });
  useEffect(() => { setTimeout(show, 300); }, []);
  return <View className="flex-1 bg-background p-6 gap-3">
    <Pressable testID={`${ID}-show`} onPress={show} style={{ padding: 12, borderRadius: 8, backgroundColor: "#3b82f6", alignSelf: "flex-start" }}>
      <Text style={{ color: "white" }}>Show toast</Text>
    </Pressable>
    <Text className="font-mono text-xs text-foreground" testID={shown ? `${ID}-shown` : undefined}>{`shown ${shown}`}</Text>
    <Toast />
  </View>;
}
