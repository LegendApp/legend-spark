import type { PropsWithChildren } from "react";
import { ScrollView, Text } from "react-native";

// Layout shared by the screens ported from legend-apps' test-kitchen-sink (several areas).
export function Panel({ title, children }: PropsWithChildren<{ title: string }>) {
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="items-center gap-4 p-6">
    <Text className="text-lg font-bold text-foreground" accessibilityRole="header">{title}</Text>
    {children}
  </ScrollView>;
}

export function Status({ testID, children }: PropsWithChildren<{ testID: string }>) {
  return <Text selectable accessibilityLiveRegion="polite" className="max-w-xl text-center text-sm text-muted" testID={testID}>{children}</Text>;
}

export const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
