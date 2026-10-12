import { useRef, type PropsWithChildren } from "react";
import { ScrollView, Text, View } from "react-native";
import { useI18n } from "../../shell/app-controller";
import { Button } from "../../Controls";
import { orientedSize, printingAvailability, usePrintingDemo, type DemoId, type ExportKind } from "./printing-demo";
import { usePrintingMessages } from "./printing-messages";

// Test IDs: document-model-printing-<demo> runs a demo and document-model-printing-<demo>-result shows its
// JSON result. After an export, document-model-printing-exported-<report|window|card>-<pages>-pages-<width>x<height> appears.
const ID = "document-model-printing";

function Section({ title, children }: PropsWithChildren<{ title: string }>) {
  return <View className="w-80 gap-3">
    <Text className="text-sm font-semibold text-foreground" accessibilityRole="header">{title}</Text>
    {children}
  </View>;
}

/** Printing, page setup and PDF export through @legendapp/spark/printing. */
export function Printing() {
  const t = usePrintingMessages();
  const { locale } = useI18n();
  const card = useRef<View>(null);
  const { pageSetup, results, exported, run } = usePrintingDemo(t, locale, card);
  const demo = (id: DemoId, label: string) => <View key={id} className="gap-1">
    <Button testID={`${ID}-${id}`} disabled={!pageSetup} onPress={() => void run(id)}>{label}</Button>
    <Text selectable numberOfLines={3} className="font-mono text-xs text-muted" testID={`${ID}-${id}-result`}>{results[id] ?? t.noResult}</Text>
  </View>;
  return <ScrollView className="flex-1 bg-background" contentContainerClassName="flex-row flex-wrap gap-8 p-6">
    <Section title={t.sections.availability}>
      <View className="gap-1">
        {Object.entries(printingAvailability()).map(([name, value]) => <Text key={name} selectable className="font-mono text-xs text-muted" testID={`${ID}-availability-${name}`}>{`${name}: ${JSON.stringify(value)}`}</Text>)}
      </View>
    </Section>
    <Section title={t.sections.pageSetup}>
      <Text className="text-sm text-foreground" testID={`${ID}-current-setup`}>{pageSetup ? t.paper(pageSetup) : t.noResult}</Text>
      <Text className="text-xs text-muted">{t.pageSetupHint}</Text>
      {demo("page-setup", t.showPageSetup)}
      {demo("system-default", t.systemDefault)}
    </Section>
    <Section title={t.sections.print}>
      <View ref={card} collapsable={false} testID={`${ID}-card`} className="gap-1 rounded-md border border-border bg-white p-4">
        <Text className="text-base font-semibold text-black">{t.card.title}</Text>
        {t.card.lines.map(([item, price]) => <View key={item} className="flex-row justify-between"><Text className="text-sm text-black">{item}</Text><Text className="text-sm text-black">{price}</Text></View>)}
        <View className="mt-1 flex-row justify-between border-t border-neutral-300 pt-1"><Text className="text-sm font-semibold text-black">{t.card.total[0]}</Text><Text className="text-sm font-semibold text-black">{t.card.total[1]}</Text></View>
      </View>
      {demo("print-report", t.printReport)}
      {demo("print-window", t.printWindow)}
      {demo("print-card", t.printCard)}
    </Section>
    <Section title={t.sections.export}>
      {demo("export", t.exportPDF)}
      {(Object.entries(exported) as [ExportKind, NonNullable<(typeof exported)[ExportKind]>][]).map(([kind, result]) => {
        const [width, height] = orientedSize(result.pageSetup);
        return <Text key={kind} className="text-sm text-foreground" testID={`${ID}-exported-${kind}-${result.numberOfPages}-pages-${width}x${height}`}>{t.exported(t.kinds[kind], result.numberOfPages, width, height)}</Text>;
      })}
    </Section>
  </ScrollView>;
}
