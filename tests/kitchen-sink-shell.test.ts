import { readdirSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import React, { act } from "react";
import { beforeEach, expect, test, vi } from "vitest";
import { reportLaunch, REPORT_FLAGS } from "../examples/kitchen-sink/launch.ts";
import { AREAS } from "../examples/kitchen-sink/shell/areas.ts";
import { MESSAGES, isRTL, resolveLocale } from "../examples/kitchen-sink/shell/i18n.ts";
import { holdRegistrations } from "../examples/kitchen-sink/shell/registrations.ts";
import { createCatalog, defineScreens } from "../examples/kitchen-sink/shell/registry.ts";
import { parseRouteURL, routeURL } from "../examples/kitchen-sink/shell/routes.ts";
const { create } = createRequire(import.meta.url)("react-test-renderer");

vi.mock("react-native", () => ({ View: "View" }));

const links = vi.hoisted(() => ({
  listener: undefined as ((event: { url: string }) => void) | undefined,
  initial: undefined as ((url: string | null) => void) | undefined,
  fail: undefined as ((error: Error) => void) | undefined,
  removed: 0,
}));
vi.mock("@legendapp/spark/links", () => ({
  addEventListener: (_type: "url", listener: (event: { url: string }) => void) => { links.listener = listener; return { remove: () => { links.removed++; } }; },
  getInitialURL: () => new Promise<string | null>((resolve, reject) => { links.initial = resolve; links.fail = reject; }),
}));
const navigation = await import("../examples/kitchen-sink/shell/navigation.ts");
beforeEach(() => { navigation.navigate({ kind: "catalog" }); links.listener = links.initial = links.fail = undefined; links.removed = 0; });

const Component = () => React.createElement("Screen");
const screen = (id: string) => ({ id, title: id, summary: id, component: Component });

test("Kitchen Sink registers the deep-link scheme with native builds", () => {
  const config = JSON.parse(readFileSync(path.join(import.meta.dirname, "../examples/kitchen-sink/desktop.config.json"), "utf8"));
  expect(config.scheme).toBe("spark-ks");
});

test("routes round-trip through spark-ks:// links", () => {
  for (const route of [{ kind: "catalog" }, { kind: "area", area: "windows" }, { kind: "screen", area: "windows", screen: "frame-autosave" }] as const)
    expect(parseRouteURL(routeURL(route))).toEqual(route);
  expect(routeURL({ kind: "screen", area: "infra", screen: "desktop-checks" })).toBe("spark-ks://infra/desktop-checks");
});

test("route parsing tolerates casing, trailing slashes, query and fragment", () => {
  expect(parseRouteURL("SPARK-KS://Windows/frame-autosave/?x=1#y")).toEqual({ kind: "screen", area: "windows", screen: "frame-autosave" });
  expect(parseRouteURL("spark-ks://menus/")).toEqual({ kind: "area", area: "menus" });
  expect(parseRouteURL("spark-ks:///")).toEqual({ kind: "catalog" });
  expect(parseRouteURL("spark-ks://infra/desk%2Dtop")).toEqual({ kind: "screen", area: "infra", screen: "desk-top" });
});

test("route parsing reports links that name no route", () => {
  const cases = { "https://example.com/a": "wrong-scheme", "spark-ks:infra": "not-a-url", "spark-ks://infra/a/b": "bad-path", "spark-ks:///screen": "bad-path", "spark-ks://infra/%E0%A4%A": "bad-encoding" };
  for (const [url, reason] of Object.entries(cases)) expect(parseRouteURL(url)).toEqual({ kind: "invalid", url, reason });
});

test("defineScreens validates area and screen ids", () => {
  expect(defineScreens("infra", [screen("a"), screen("b-2")]).screens).toHaveLength(2);
  expect(() => defineScreens("nope" as never, [])).toThrow("Unknown Kitchen Sink area");
  expect(() => defineScreens("infra", [screen("Bad_Id")])).toThrow("kebab-case");
  expect(() => defineScreens("infra", [screen("a"), screen("a")])).toThrow("registered twice");
});

test("the catalog lists every area in epic order and resolves registered screens", () => {
  const catalog = createCatalog([
    ["./windows/index.tsx", { default: defineScreens("windows", [screen("frame")]) }],
    ["./infra/index.tsx", { default: defineScreens("infra", [screen("desktop-checks")]) }],
  ]);
  expect(catalog.areas.map(area => area.id)).toEqual(AREAS.map(area => area.id));
  expect(catalog.screen("windows", "frame")?.id).toBe("frame");
  expect(catalog.area("menus")?.screens).toEqual([]);
  expect(catalog.screen("windows", "missing")).toBeUndefined();
  expect(catalog.area("missing")).toBeUndefined();
});

test("the registry renders every screen inside its <area>-<screen>-root view", async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const catalog = createCatalog([["./windows/index.tsx", { default: defineScreens("windows", [screen("frame"), screen("frame-autosave")]) }]]);
  for (const registered of catalog.area("windows")!.screens) {
    let rendered: any;
    await act(async () => { rendered = create(React.createElement(registered.Root)); });
    const root = rendered.root.findByType("View");
    expect(root.props.testID).toBe(`windows-${registered.id}-root`);
    expect(registered.testID).toBe(root.props.testID);
    expect(root.findByType("Screen")).toBeDefined();
    await act(async () => rendered.unmount());
  }
});

test("the catalog rejects misplaced or malformed area modules", () => {
  expect(() => createCatalog([["./infra/other.tsx", { default: defineScreens("infra", []) }]])).toThrow("screens/<area>/index.tsx");
  expect(() => createCatalog([["./unknown/index.tsx", { default: defineScreens("infra", []) }]])).toThrow("not a Kitchen Sink area");
  expect(() => createCatalog([["./infra/index.tsx", {}]])).toThrow("must default-export defineScreens");
  expect(() => createCatalog([["./windows/index.tsx", { default: defineScreens("infra", []) }]])).toThrow('it must register "windows"');
  expect(() => createCatalog([["./infra/index.tsx", { default: defineScreens("infra", []) }], ["./infra/index.ts", { default: defineScreens("infra", []) }]])).toThrow("registered twice");
});

test("every checked-in screens/<area> folder is a known area with an index", () => {
  const root = path.join(import.meta.dirname, "../examples/kitchen-sink/screens");
  const folders = readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name);
  expect(folders).toEqual(expect.arrayContaining(["infra", "native-controls", "keyboard", "windows", "future-facing-capabilities"]));
  for (const folder of folders) {
    expect(AREAS.map(area => area.id)).toContain(folder);
    expect(existsSync(path.join(root, folder, "index.tsx")) || existsSync(path.join(root, folder, "index.ts"))).toBe(true);
  }
});

test("deep links route the launch URL, then live opens", async () => {
  const subscription = navigation.listenForDeepLinks(error => { throw error; });
  links.initial!("spark-ks://infra/desktop-checks");
  await Promise.resolve();
  expect(navigation.getLocation()).toEqual({ kind: "screen", area: "infra", screen: "desktop-checks" });
  links.listener!({ url: "spark-ks://windows" });
  expect(navigation.getLocation()).toEqual({ kind: "area", area: "windows" });
  subscription.remove();
  expect(links.removed).toBe(1);
});

test("a late launch URL never replaces a newer live open", async () => {
  const subscription = navigation.listenForDeepLinks(error => { throw error; });
  links.listener!({ url: "spark-ks://menus" });
  links.initial!("spark-ks://infra/desktop-checks");
  await Promise.resolve();
  expect(navigation.getLocation()).toEqual({ kind: "area", area: "menus" });
  subscription.remove();
});

test("a launch URL resolving after removal is ignored, and failures are reported", async () => {
  navigation.listenForDeepLinks(error => { throw error; }).remove();
  links.initial!("spark-ks://menus");
  await Promise.resolve();
  expect(navigation.getLocation()).toEqual({ kind: "catalog" });
  const errors: unknown[] = [];
  const failing = navigation.listenForDeepLinks(error => errors.push(error));
  links.fail!(new Error("initial URL unavailable"));
  await Promise.resolve(); await Promise.resolve();
  expect(errors).toEqual([new Error("initial URL unavailable")]);
  failing.remove();
});

test("report launch flags select report modes; anything else is interactive", () => {
  expect(reportLaunch([])).toBeUndefined();
  expect(reportLaunch(["--spark-test-report"])).toBeUndefined();
  expect(reportLaunch(["--spark-ui-report", "/tmp/ui.json", "--spark-test-report", "/tmp/t.json"])).toEqual({ flag: "--spark-ui-report", report: "/tmp/ui.json" });
  for (const flag of REPORT_FLAGS) expect(reportLaunch(["x", flag, "/tmp/r"])?.flag).toBe(flag);
});

test("system locales map to a catalog, Arabic is right-to-left, and every area has a title", () => {
  expect(resolveLocale("ar_EG")).toBe("ar");
  expect(resolveLocale("AR-sa")).toBe("ar");
  expect(resolveLocale("en_US@calendar=gregorian")).toBe("en");
  expect(resolveLocale("fr_FR")).toBe("en");
  expect(resolveLocale("constructor")).toBe("en");
  expect(isRTL("ar")).toBe(true);
  expect(isRTL("en")).toBe(false);
  for (const messages of Object.values(MESSAGES))
    for (const area of AREAS) expect(messages.areas[area.id]).toMatch(/\S/);
});

test("Arabic counts use Arabic plural forms and digits", () => {
  const { ar, en } = MESSAGES;
  expect([0, 1, 2, 3, 10, 11, 99, 100, 103].map(ar.screens)).toEqual(["لا توجد شاشات", "شاشة واحدة", "شاشتان", "٣ شاشات", "١٠ شاشات", "١١ شاشة", "٩٩ شاشة", "١٠٠ شاشة", "١٠٣ شاشات"]);
  expect([1, 2].map(en.screens)).toEqual(["1 screen", "2 screens"]);
  expect(ar.number(37)).toBe("٣٧");
});

test("held registrations are removed, including ones that resolve after removal", async () => {
  const removed: string[] = [], errors: unknown[] = [];
  let resolveLate!: (value: { remove(): void }) => void;
  const held = holdRegistrations(hold => {
    hold({ remove: () => removed.push("sync") });
    hold(Promise.resolve({ remove: () => removed.push("async") }));
    hold(new Promise(resolve => { resolveLate = resolve; }));
    hold(Promise.reject(new Error("unavailable")));
  }, error => errors.push(error));
  await new Promise(resolve => setTimeout(resolve));
  held.remove();
  await new Promise(resolve => setTimeout(resolve));
  expect(removed.sort()).toEqual(["async", "sync"]);
  resolveLate({ remove: () => removed.push("late") });
  await new Promise(resolve => setTimeout(resolve));
  expect(removed).toContain("late");
  expect(errors).toEqual([new Error("unavailable")]);
  const failing = holdRegistrations(() => { throw new Error("setup failed"); }, error => errors.push(error));
  failing.remove();
  expect(errors.at(-1)).toEqual(new Error("setup failed"));
});

test("Kitchen Sink declares Arabic and uses the shipping apps' build and package commands", () => {
  const root = path.join(import.meta.dirname, "..");
  const config = JSON.parse(readFileSync(path.join(root, "examples/kitchen-sink/desktop.config.json"), "utf8"));
  expect(config.macos.infoPlist.CFBundleLocalizations).toEqual(["en", "ar"]);
  const scripts = JSON.parse(readFileSync(path.join(root, "examples/kitchen-sink/package.json"), "utf8")).scripts;
  const shipping = JSON.parse(readFileSync(path.join(root, "packages/cli/templates/blank-typescript/package.json"), "utf8")).scripts;
  for (const name of ["build", "package"]) expect(scripts[name].replace("bun ../../scripts/spark.mjs", "spark")).toBe(shipping[name]);
});
