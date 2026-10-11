import { Text, View } from "react-native";
import { Panel, Status } from "../../Panel";
import { useDeveloperMenuMessages } from "./developer-menu-messages";
import { stateId, stateText, useDeveloperMenuState } from "./developer-menu-state";

// Test IDs: devtools-dev-menu-status (localized) and devtools-dev-menu-state-<state> (stateId: ready,
// ready-no-shortcut, installing, error, unavailable-<reason>).
const ID = "devtools-dev-menu";

export function DeveloperMenu() {
  const t = useDeveloperMenuMessages(), state = useDeveloperMenuState();
  return <Panel title={t.title}>
    <Text className="max-w-xl text-center text-sm text-muted">{t.intro}</Text>
    <Status testID={`${ID}-status`}>{t.status(state)}</Status>
    <Text selectable className="font-mono text-xs text-muted" testID={`${ID}-state-${stateId(state)}`}>{stateText(state)}</Text>
    <View className="w-full max-w-xl gap-1" testID={`${ID}-items`}>
      <Text className="text-sm font-semibold text-foreground" accessibilityRole="header">{t.items.title}</Text>
      {t.items.rows.map(([name, description]) => <View key={name} className="flex-row gap-3 border-b border-border py-1">
        <Text className="w-48 text-sm text-foreground">{name}</Text>
        <Text className="flex-1 text-sm text-muted">{description}</Text>
      </View>)}
    </View>
    <Text className="max-w-xl text-center text-xs text-muted">{t.targeting}</Text>
  </Panel>;
}
