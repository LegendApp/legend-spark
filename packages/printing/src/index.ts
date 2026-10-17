import type { ComponentRef } from "react";
import { findNodeHandle, Platform, type View } from "react-native";
import { SparkError, invokeNative, parseNativeResult, type Availability } from "@legendapp/spark-desktop-app/src/contracts";
import { nativePath } from "@legendapp/spark-desktop-app/src/contracts/path";
import Native, { type Spec } from "./NativeDesktopPrinting";

/** In points (1/72 inch). */
export interface PaperSize { width: number; height: number }
/** Distances from the edges of the oriented page, in points. */
export interface PageMargins { top: number; right: number; bottom: number; left: number }
/** Page orientation in a `PageSetup`; landscape turns the portrait `paperSize` sideways. */
export type PageOrientation = "portrait" | "landscape";
/**
 * Plain data, so the caller decides where it lives: in a document's metadata, in an app settings
 * store, or nowhere. Pass it back to print, showPageSetup and exportPDF.
 */
export interface PageSetup {
  /** The sheet as it sits in portrait: width <= height. `orientation` turns it. */
  paperSize: PaperSize;
  orientation: PageOrientation;
  margins: PageMargins;
}
/** Common sheets in points, portrait. */
export const paperSizes = {
  letter: { width: 612, height: 792 },
  legal: { width: 612, height: 1008 },
  tabloid: { width: 792, height: 1224 },
  a3: { width: 841.89, height: 1190.55 },
  a4: { width: 595.28, height: 841.89 },
  a5: { width: 419.53, height: 595.28 },
} as const satisfies Record<string, PaperSize>;

/** A mounted View. Give it `collapsable={false}` so React Native keeps a native view to print. */
export type PrintableView = ComponentRef<typeof View>;
/**
 * What to print or export. Text, HTML and PDF documents reflow or scale onto the pages; a window
 * or view prints what it draws now, scaled down to the page width and continued across pages.
 */
export type PrintContent =
  | { type: "text"; text: string }
  | { type: "html"; html: string }
  | { type: "pdf"; path: string }
  | { type: "window"; windowId: string }
  | { type: "view"; view: PrintableView };
/** Options for `print`. Unknown keys reject E_UNSUPPORTED_OPTION; an invalid `pageSetup` rejects E_INVALID_ARGUMENT. */
export interface PrintOptions {
  /** The initial paper, orientation and margins. Default: the system's (the default printer's paper). */
  pageSetup?: PageSetup;
  /** Shows the print panel as a sheet on this window; otherwise it is application-modal. */
  windowId?: string;
  /** The print job's name, also the suggested name when saving as PDF from the panel. */
  title?: string;
}
/** `canceled: false` means the job went to the printer or the panel's PDF destination, with the page setup the panel settled on. */
export type PrintResult = { canceled: true } | { canceled: false; pageSetup: PageSetup };
/** Options for `showPageSetup`. Unknown keys reject E_UNSUPPORTED_OPTION. */
export interface PageSetupOptions {
  /** The setup the panel starts from. Margins are not in the macOS panel and come back unchanged. */
  pageSetup?: PageSetup;
  /** Shows the panel as a sheet on this window; otherwise it is application-modal. */
  windowId?: string;
}
/** Result of `showPageSetup`: canceled, or the page setup the user chose. */
export type PageSetupResult = { canceled: true } | { canceled: false; pageSetup: PageSetup };
/** Options for `exportPDF`. Unknown keys reject E_UNSUPPORTED_OPTION. */
export interface ExportPDFOptions {
  /** Default: the system's page setup, which depends on the default printer; pass one for repeatable output. */
  pageSetup?: PageSetup;
  /** The PDF's Title metadata. */
  title?: string;
}
/** Result of `exportPDF`: the written file's absolute path, its page count (at least 1) and the page setup used. */
export interface ExportPDFResult { path: string; numberOfPages: number; pageSetup: PageSetup }
/** Parts of printing, for `getPrintingAvailability(feature)`. */
export type PrintingFeature = "printPanel" | "pageSetup" | "pdfExport";
const FEATURES: readonly PrintingFeature[] = ["printPanel", "pageSetup", "pdfExport"];
const NAMES: Record<PrintingFeature, string> = { printPanel: "Printing", pageSetup: "Page setup", pdfExport: "PDF export" };

/** Without a feature, reports printing as a whole. macOS only; Windows is tracked in #275. */
export function getPrintingAvailability(feature?: PrintingFeature): Availability {
  if (feature !== undefined && !FEATURES.includes(feature)) throw new SparkError("E_INVALID_ARGUMENT", "Unknown printing feature");
  if (Platform.OS !== "macos") return { available: false, reason: "unsupported-platform" };
  return Native ? { available: true } : { available: false, reason: "missing-module" };
}
function requireAvailable(feature: PrintingFeature): Spec {
  const availability = getPrintingAvailability(feature);
  if (!availability.available) throw new SparkError(availability.reason === "unsupported-platform" ? "E_UNSUPPORTED_PLATFORM" : "E_MODULE_UNAVAILABLE", `${NAMES[feature]} requires macOS with NativeDesktopPrinting installed`);
  return Native!;
}

const invalid = (message: string): never => { throw new SparkError("E_INVALID_ARGUMENT", message); };
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
function knownKeys(value: unknown, allowed: readonly string[], what: string): Record<string, unknown> {
  if (!isRecord(value)) invalid(`Expected ${what}`);
  for (const key of Object.keys(value as object)) if (!allowed.includes(key)) throw new SparkError("E_UNSUPPORTED_OPTION", `Unsupported ${what} key: ${key}`);
  return value as Record<string, unknown>;
}
function windowId(value: unknown) {
  if (value !== undefined && (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(value))) invalid("Invalid window ID");
  return value as string | undefined;
}
function title(value: unknown) {
  if (value !== undefined && (typeof value !== "string" || !value || value.includes("\0"))) invalid("title must be a non-empty string without NUL characters");
  return value as string | undefined;
}

/** The largest PDF page side (200 inches). */
const MAX_POINTS = 14400;
const points = (value: unknown, min: number) => typeof value === "number" && Number.isFinite(value) && value >= min && value <= MAX_POINTS;
function pageSetup(value: unknown): PageSetup | undefined {
  if (value === undefined) return undefined;
  const setup = knownKeys(value, ["paperSize", "orientation", "margins"], "page setup");
  const paper = knownKeys(setup.paperSize, ["width", "height"], "paper size");
  const margins = knownKeys(setup.margins, ["top", "right", "bottom", "left"], "page margins");
  if (!points(paper.width, 1) || !points(paper.height, 1)) invalid(`Paper width and height are points from 1 to ${MAX_POINTS}`);
  const width = paper.width as number, height = paper.height as number;
  if (width > height) invalid("paperSize is the portrait sheet (width <= height); use orientation: \"landscape\" to turn it");
  if (setup.orientation !== "portrait" && setup.orientation !== "landscape") invalid("orientation is portrait or landscape");
  if (!["top", "right", "bottom", "left"].every(edge => points(margins[edge], 0))) invalid("Margins are top, right, bottom and left in points, 0 or more");
  const [across, down] = setup.orientation === "landscape" ? [height, width] : [width, height];
  const { top, right, bottom, left } = margins as unknown as PageMargins;
  if (across - left - right < 72 || down - top - bottom < 72) invalid("Margins must leave at least 72 points (1 inch) of printable width and height");
  return { paperSize: { width, height }, orientation: setup.orientation as PageOrientation, margins: { top, right, bottom, left } };
}

type WireContent = { type: "text"; text: string } | { type: "html"; html: string } | { type: "pdf"; path: string } | { type: "window"; windowId: string } | { type: "view"; tag: number };
function content(value: PrintContent): WireContent {
  const type = isRecord(value) ? value.type : undefined;
  switch (type) {
    case "text": case "html": {
      const text = knownKeys(value, ["type", type], `${type} content`)[type];
      if (typeof text !== "string" || !text) invalid(`${type} content needs a non-empty ${type} string`);
      return type === "text" ? { type, text: text as string } : { type, html: text as string };
    }
    case "pdf": return { type, path: nativePath(knownKeys(value, ["type", "path"], "PDF content").path as string, Platform.OS) };
    case "window": {
      const id = windowId(knownKeys(value, ["type", "windowId"], "window content").windowId);
      return id === undefined ? invalid("window content needs a windowId") : { type, windowId: id };
    }
    case "view": {
      const view = knownKeys(value, ["type", "view"], "view content").view;
      if (!view || typeof view !== "object") invalid("view content needs a mounted View ref");
      const tag = findNodeHandle(view as never);
      if (typeof tag !== "number") throw new SparkError("E_NOT_FOUND", "The view is not mounted");
      return { type, tag };
    }
    default: return invalid("Print content type is text, html, pdf, window or view");
  }
}

const isPageSetup = (value: unknown): value is PageSetup => {
  if (!isRecord(value) || !isRecord(value.paperSize) || !isRecord(value.margins) || (value.orientation !== "portrait" && value.orientation !== "landscape")) return false;
  const { paperSize, margins } = value;
  return [paperSize.width, paperSize.height, margins.top, margins.right, margins.bottom, margins.left].every(number => typeof number === "number" && Number.isFinite(number) && number >= 0);
};
const isPanelResult = (value: unknown): value is PrintResult => isRecord(value) && (value.canceled === true ? Object.keys(value).length === 1 : value.canceled === false && isPageSetup(value.pageSetup));
async function call<T>(native: Spec, method: string, args: object, validate: (value: unknown) => value is T): Promise<T> {
  return parseNativeResult(await invokeNative(() => native.call(method, JSON.stringify(args))), validate);
}

/** Shows the print panel with a live preview. The user can change paper, orientation and scale there. */
export async function print(printContent: PrintContent, options: PrintOptions = {}): Promise<PrintResult> {
  knownKeys(options, ["pageSetup", "windowId", "title"], "print options");
  const args = { content: content(printContent), pageSetup: pageSetup(options.pageSetup), windowId: windowId(options.windowId), jobTitle: title(options.title) };
  return call(requireAvailable("printPanel"), "print", args, isPanelResult);
}

/** Shows the page setup panel (paper and orientation) and returns the result to keep. */
export async function showPageSetup(options: PageSetupOptions = {}): Promise<PageSetupResult> {
  knownKeys(options, ["pageSetup", "windowId"], "page setup options");
  const args = { pageSetup: pageSetup(options.pageSetup), windowId: windowId(options.windowId) };
  return call(requireAvailable("pageSetup"), "pageSetup", args, isPanelResult);
}

/** The system's current page setup: the default printer's paper and AppKit's default margins. */
export async function getDefaultPageSetup(): Promise<PageSetup> {
  return call(requireAvailable("pageSetup"), "defaultPageSetup", {}, isPageSetup);
}

/**
 * Renders the content's pages into a PDF at `path`, replacing a file there. No UI is shown and the
 * printing system is not involved, so it works headless, in tests and for agents.
 */
export async function exportPDF(printContent: PrintContent, path: string, options: ExportPDFOptions = {}): Promise<ExportPDFResult> {
  knownKeys(options, ["pageSetup", "title"], "PDF export options");
  const args = { content: content(printContent), path: nativePath(path, Platform.OS), pageSetup: pageSetup(options.pageSetup), title: title(options.title) };
  return call(requireAvailable("pdfExport"), "exportPDF", args, (value): value is ExportPDFResult => isRecord(value) && value.path === args.path && Number.isInteger(value.numberOfPages) && (value.numberOfPages as number) >= 1 && isPageSetup(value.pageSetup));
}
