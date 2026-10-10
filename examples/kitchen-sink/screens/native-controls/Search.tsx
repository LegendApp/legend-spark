import { TextInputSearch, type TextInputSearchRef } from "@legendapp/spark/ui/search";
import { useRef, useState } from "react";
import { Button } from "../../Controls";
import { Panel, Status, errorText } from "../../Panel";

const field = { height: 32, width: 320 };

export function Search() {
  const focusable = useRef<TextInputSearchRef>(null);
  const [value, setValue] = useState("");
  return <Panel title="Native search field">
    <Status testID="native-controls-search-value">Native search field value: {value || "empty"}</Status>
    <TextInputSearch testID="native-controls-search-field" accessibilityLabel="Search library" defaultValue="" onChangeText={setValue} placeholder="Search library" style={field} />
    <Button testID="native-controls-search-focus" onPress={() => { try { focusable.current?.focus(); } catch (error) { setValue(errorText(error)); } }}>Focus search</Button>
    <TextInputSearch ref={focusable} testID="native-controls-search-focusable-field" accessibilityLabel="Focusable search field" onChangeText={text => setValue(`focused: ${text}`)} placeholder="Focusable search field" style={field} />
  </Panel>;
}
