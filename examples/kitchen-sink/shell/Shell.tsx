import type { ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useAppState, useI18n } from "./app-controller";
import { catalog } from "./catalog";
import { navigate, useLocation } from "./navigation";
import type { CatalogArea, CatalogScreen } from "./registry";
import { routeURL, type Location, type Route } from "./routes";
import { ThemeToggle } from "./ThemeToggle";

// Shell testIDs follow <area>-<screen>-<element> as area "infra", screen "shell".
export function Shell(props: { mode?: string; projectId?: string }) {
  const locale = useAppState(state => state.locale);
  const errors = useAppState(state => state.errors);
  // Strings need the system locale; until it is read only startup failures can be shown.
  if (!locale) return <View className="flex-1 bg-background p-6" testID="infra-shell-starting">
    {errors.length > 0 && <Text className="text-sm text-danger" selectable testID="infra-shell-error">{errors.join("\n")}</Text>}
  </View>;
  return <LocalizedShell {...props} />;
}

function LocalizedShell({ mode, projectId }: { mode?: string; projectId?: string }) {
  const { t, rtl } = useI18n();
  const location = useLocation();
  const errors = useAppState(state => state.errors);
  return <View className="flex-1 flex-row bg-background" style={{ direction: rtl ? "rtl" : "ltr" }} testID="infra-shell-root">
    <View className="w-64 border-e border-border bg-surface" testID="infra-shell-sidebar">
      <View className="gap-1 p-4">
        <Text className="text-xl font-bold text-foreground" accessibilityRole="header">{t.appTitle}</Text>
        <Text className="text-xs text-muted">{t.subtitle(mode, projectId)}</Text>
      </View>
      <ScrollView contentContainerClassName="pb-4">
        <NavRow testID="infra-shell-catalog" selected={location.kind === "catalog"} onPress={() => navigate({ kind: "catalog" })} title={t.allScreens} />
        {catalog.areas.map(area => <NavRow key={area.id} testID={`infra-shell-area-${area.id}`}
          selected={location.kind !== "catalog" && location.kind !== "invalid" && location.area === area.id}
          onPress={() => navigate({ kind: "area", area: area.id })} title={t.areas[area.id]} count={area.screens.length} />)}
      </ScrollView>
    </View>
    <View className="flex-1">
      <View className="flex-row items-center gap-3 border-b border-border px-6 py-3">
        <Breadcrumb location={location} />
        <ThemeToggle />
      </View>
      {errors.length > 0 && <Text className="px-6 py-2 text-sm text-danger" selectable testID="infra-shell-error" accessibilityLiveRegion="polite">{errors.map(t.setupFailed).join("\n")}</Text>}
      <Content location={location} />
    </View>
  </View>;
}

function NavRow({ title, count, selected, onPress, testID }: { title: string; count?: number; selected: boolean; onPress: () => void; testID: string }) {
  const { t } = useI18n();
  return <Pressable testID={testID} accessibilityRole="button" accessibilityState={{ selected }} accessibilityLabel={count === undefined ? title : t.navLabel(title, count)}
    onPress={onPress} className={`mx-2 flex-row items-center gap-2 rounded-md px-3 py-1.5 ${selected ? "bg-highlight" : ""}`}>
    <Text numberOfLines={1} className={`flex-1 text-sm ${count === 0 ? "text-muted" : "text-foreground"}`}>{title}</Text>
    {count !== undefined && <Text className="text-xs text-muted">{t.number(count)}</Text>}
  </Pressable>;
}

function Breadcrumb({ location }: { location: Location }) {
  const { t, rtl } = useI18n();
  const area = location.kind === "area" || location.kind === "screen" ? catalog.area(location.area) : undefined;
  const screen = location.kind === "screen" ? catalog.screen(location.area, location.screen) : undefined;
  // The separator points along the reading direction.
  const separator = <Text className="text-muted" testID="infra-shell-breadcrumb-separator">{rtl ? "‹" : "›"}</Text>;
  return <View className="flex-1 flex-row items-center gap-2" testID="infra-shell-breadcrumb">
    <Crumb onPress={location.kind === "catalog" ? undefined : () => navigate({ kind: "catalog" })}>{t.allScreens}</Crumb>
    {area && <>{separator}<Crumb onPress={location.kind === "screen" ? () => navigate({ kind: "area", area: area.id }) : undefined}>{t.areas[area.id]}</Crumb></>}
    {screen && <>{separator}<Crumb>{screen.title}</Crumb></>}
  </View>;
}
function Crumb({ children, onPress }: { children: ReactNode; onPress?: () => void }) {
  return onPress
    ? <Pressable accessibilityRole="link" onPress={onPress}><Text className="text-sm text-muted">{children}</Text></Pressable>
    : <Text className="text-sm font-semibold text-foreground" accessibilityRole="header">{children}</Text>;
}

function Content({ location }: { location: Location }) {
  const { t } = useI18n();
  if (location.kind === "invalid") return <NotFound url={location.url} reason={t.reasons[location.reason]} />;
  if (location.kind === "catalog") return <Home />;
  const area = catalog.area(location.area);
  if (!area) return <NotFound url={routeURL(location)} reason={t.unknownArea(location.area)} />;
  if (location.kind === "area") return <AreaScreens area={area} />;
  const screen = catalog.screen(area.id, location.screen);
  if (!screen) return <NotFound url={routeURL(location)} reason={t.unknownScreen(t.areas[area.id], location.screen)} />;
  // Each screen's Root is its own component type, so route changes remount and release screen registrations.
  return <screen.Root />;
}

function Home() {
  const { t } = useI18n();
  const populated = catalog.areas.filter(area => area.screens.length);
  return <ScrollView contentContainerClassName="gap-6 p-6" testID="infra-shell-home">
    <Text className="text-sm text-muted">{t.home(populated.length, catalog.areas.length)}</Text>
    {populated.map(area => <View key={area.id} className="gap-2">
      <Text className="text-lg font-semibold text-foreground" accessibilityRole="header">{t.areas[area.id]}</Text>
      {area.screens.map(screen => <ScreenRow key={screen.id} area={area} screen={screen} />)}
    </View>)}
  </ScrollView>;
}

function AreaScreens({ area }: { area: CatalogArea }) {
  const { t } = useI18n();
  return <ScrollView contentContainerClassName="gap-3 p-6" testID={`infra-shell-area-${area.id}-screens`}>
    <Text className="text-2xl font-bold text-foreground" accessibilityRole="header">{t.areas[area.id]}</Text>
    <Text className="text-sm text-muted" selectable>{t.areaChecks(area.prefix, area.id, routeURL({ kind: "area", area: area.id }))}</Text>
    {area.screens.length
      ? area.screens.map(screen => <ScreenRow key={screen.id} area={area} screen={screen} />)
      : <Text className="text-sm text-muted" testID="infra-shell-area-empty">{t.areaEmpty(area.id)}</Text>}
  </ScrollView>;
}

function ScreenRow({ area, screen }: { area: CatalogArea; screen: CatalogScreen }) {
  const route: Route = { kind: "screen", area: area.id, screen: screen.id };
  return <Pressable testID={`infra-shell-screen-${area.id}-${screen.id}`} accessibilityRole="button" accessibilityLabel={screen.title} accessibilityHint={screen.summary}
    onPress={() => navigate(route)} className="gap-1 rounded-lg border border-border bg-surface p-4">
    <Text className="font-semibold text-foreground">{screen.title}</Text>
    <Text className="text-sm text-muted">{screen.summary}</Text>
    <Text className="text-xs text-muted">{routeURL(route)}</Text>
  </Pressable>;
}

function NotFound({ url, reason }: { url: string; reason: string }) {
  const { t } = useI18n();
  return <View className="gap-3 p-6" testID="infra-shell-not-found">
    <Text className="text-2xl font-bold text-foreground" accessibilityRole="header">{t.notFound}</Text>
    <Text className="text-foreground" selectable testID="infra-shell-not-found-url">{url}</Text>
    <Text className="text-muted" testID="infra-shell-not-found-reason">{reason}</Text>
  </View>;
}
