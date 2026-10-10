import { createElement, type ComponentType } from "react";
import { View } from "react-native";
import { AREAS, type Area, type AreaId } from "./areas";

export type Screen = {
  /** Lowercase kebab-case; the deep link is spark-ks://<area>/<id>. */
  id: string;
  title: string;
  summary: string;
  component: ComponentType;
};
/** A registered screen. Render `Root`: its root view carries `testID` (`<area>-<screen>-root`). */
export type CatalogScreen = Screen & { testID: string; Root: ComponentType };
export type AreaScreens = { area: AreaId; screens: readonly Screen[] };
export type CatalogArea = Area & { screens: readonly CatalogScreen[] };
export type Catalog = {
  areas: readonly CatalogArea[];
  area(id: string): CatalogArea | undefined;
  screen(area: string, id: string): CatalogScreen | undefined;
};

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The test driver waits for this ID to confirm a navigated screen has rendered. */
export function screenRootTestID(area: string, screen: string) { return `${area}-${screen}-root`; }

/** The default export of screens/<area>/index.tsx. */
export function defineScreens(area: AreaId, screens: readonly Screen[]): AreaScreens {
  if (!AREAS.some(known => known.id === area)) throw new Error(`Unknown Kitchen Sink area "${area}"; areas are listed in shell/areas.ts.`);
  const seen = new Set<string>();
  for (const screen of screens) {
    if (!SLUG.test(screen.id)) throw new Error(`Screen id "${screen.id}" in ${area} must be lowercase kebab-case.`);
    if (seen.has(screen.id)) throw new Error(`Screen id "${screen.id}" is registered twice in ${area}.`);
    seen.add(screen.id);
  }
  return { area, screens };
}

// The registry owns each screen's root view, so no screen can omit or misname its root testID.
function withRoot(area: AreaId, screen: Screen): CatalogScreen {
  const testID = screenRootTestID(area, screen.id);
  const Root = () => createElement(View, { testID, style: { flex: 1 } }, createElement(screen.component));
  Root.displayName = `ScreenRoot(${area}/${screen.id})`;
  return { ...screen, testID, Root };
}

/** Builds the catalog from `require.context` entries keyed `./<area>/index.tsx`. */
export function createCatalog(modules: ReadonlyArray<readonly [key: string, module: { default?: unknown }]>): Catalog {
  const registered = new Map<AreaId, readonly Screen[]>();
  for (const [key, module] of modules) {
    const folder = /^\.\/([^/]+)\/index\.tsx?$/.exec(key)?.[1];
    if (!folder) throw new Error(`Unexpected screen module ${key}; register screens in screens/<area>/index.tsx.`);
    const area = AREAS.find(known => known.id === folder)?.id;
    if (!area) throw new Error(`screens/${folder} is not a Kitchen Sink area; areas are listed in shell/areas.ts.`);
    const value = module.default as Partial<AreaScreens> | undefined;
    if (!value || !Array.isArray(value.screens)) throw new Error(`screens/${folder}/index.tsx must default-export defineScreens(...).`);
    if (value.area !== folder) throw new Error(`screens/${folder}/index.tsx registers area "${value.area}"; it must register "${folder}".`);
    if (registered.has(area)) throw new Error(`screens/${folder} is registered twice.`);
    registered.set(area, value.screens);
  }
  const areas = AREAS.map(area => ({ ...area, screens: (registered.get(area.id) ?? []).map(screen => withRoot(area.id, screen)) }));
  return {
    areas,
    area: id => areas.find(area => area.id === id),
    screen: (area, id) => areas.find(candidate => candidate.id === area)?.screens.find(screen => screen.id === id),
  };
}
