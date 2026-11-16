import { useState } from "react";
import { ScrollView } from "react-native";
import { Button, Card, Chip, MD3LightTheme, PaperProvider, Switch, Text, TextInput } from "react-native-paper";

// Test IDs: component-library-paper-button (press it), -presses-<n>, -card, -switch.
const ID = "component-library-paper";

/** react-native-paper: Material Design 3 components under a PaperProvider. */
export function PaperDemo() {
  const [presses, setPresses] = useState(0);
  const [on, setOn] = useState(false);
  const [text, setText] = useState("Hello");
  return <PaperProvider theme={MD3LightTheme}><ScrollView style={{ flex: 1, backgroundColor: MD3LightTheme.colors.background }} contentContainerStyle={{ gap: 12, padding: 24 }}>
    <Card testID={`${ID}-card`}><Card.Title title="Paper card" subtitle="Material Design 3" /><Card.Content><Text variant="bodyMedium">Cards, buttons, chips, switches and text inputs.</Text></Card.Content></Card>
    <Button testID={`${ID}-button`} mode="contained" onPress={() => setPresses(count => count + 1)}>Press me</Button>
    <Text testID={`${ID}-presses-${presses}`}>{`presses ${presses}`}</Text>
    <Chip onPress={() => {}}>Chip</Chip>
    <Switch testID={`${ID}-switch`} value={on} onValueChange={setOn} />
    <TextInput label="Text input" value={text} onChangeText={setText} />
  </ScrollView></PaperProvider>;
}
