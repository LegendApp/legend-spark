import { useState } from "react";
import { Text, TextInput } from "react-native";
import { KeyboardAwareScrollView, KeyboardController, KeyboardProvider, KeyboardToolbar, useKeyboardState } from "react-native-keyboard-controller";

// Test IDs: keyboard-keyboard-controller-passed once the provider, scroll view and toolbar render and the
// keyboard reports hidden. A Mac has no software keyboard, so the library runs its no-op web bindings.
const ID = "keyboard-keyboard-controller";

function Content() {
  const visible = useKeyboardState(state => state.isVisible);
  const [text, setText] = useState("");
  const hidden = !visible && !KeyboardController.isVisible();
  return <>
    <KeyboardAwareScrollView bottomOffset={24} contentContainerStyle={{ gap: 12, padding: 24 }}>
      <Text className="text-sm text-muted">KeyboardProvider, KeyboardAwareScrollView and KeyboardToolbar render; with no software keyboard on a Mac they leave layout unchanged.</Text>
      <TextInput className="rounded-md border border-border px-3 py-2 text-foreground" placeholder="Type here" value={text} onChangeText={setText} />
      <Text selectable className="font-mono text-xs text-foreground" testID={hidden ? `${ID}-passed` : `${ID}-failed`}>{hidden ? "passed" : "failed: keyboard reported visible"}</Text>
    </KeyboardAwareScrollView>
    <KeyboardToolbar />
  </>;
}

/** react-native-keyboard-controller through its own API; Spark's patch selects its web bindings on macOS. */
export function KeyboardControllerDemo() {
  return <KeyboardProvider><Content /></KeyboardProvider>;
}
