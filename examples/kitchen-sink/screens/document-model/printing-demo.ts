import { useCallback, useEffect, useState, type RefObject } from "react";
import type { View } from "react-native";
import * as app from "@legendapp/spark/app";
import { SparkError } from "@legendapp/spark/contracts";
import { saveFileDialog } from "@legendapp/spark/dialogs";
import {
  exportPDF, getDefaultPageSetup, getPrintingAvailability, paperSizes, print, showPageSetup,
  type ExportPDFResult, type PageSetup, type PrintContent,
} from "@legendapp/spark/printing";
import { settings } from "@legendapp/spark/settings";
import type { Locale } from "../../shell/i18n";
import type { PrintingMessages } from "./printing-messages";

export type ExportKind = "report" | "window" | "card";
export type DemoId = "page-setup" | "system-default" | "print-report" | "print-window" | "print-card" | "export";
/**
 * `--ks-print-export <folder>` exports report.pdf, window.pdf and card.pdf there on launch, with
 * APP_PAGE_SETUP, for the driver flow (driver mode cannot click yet).
 */
export const EXPORT_FLAG = "--ks-print-export";
/** The app's own default until the user picks a setup; the system default depends on the printer. */
export const APP_PAGE_SETUP: PageSetup = { paperSize: paperSizes.a4, orientation: "portrait", margins: { top: 54, right: 54, bottom: 54, left: 54 } };
/** One page setup for the whole app, kept in its settings. A document app would keep it in each document instead. */
const SETTING = "document-model-printing-page-setup";

/** Availability readouts, keyed by the testID suffix that shows them. */
export function printingAvailability() {
  return { printing: getPrintingAvailability(), "print-panel": getPrintingAvailability("printPanel"), "page-setup": getPrintingAvailability("pageSetup"), "pdf-export": getPrintingAvailability("pdfExport") };
}

const group = (value: number) => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const escape = (value: string) => value.replace(/[&<>"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[char]!);
/** A multi-page report in the screen's language, right to left in Arabic. */
export function reportHTML(t: PrintingMessages, locale: Locale) {
  const { report } = t;
  const rows = report.regions.map((region, index) => `<tr><td>${escape(region)}</td><td>${group(1200 + index * 317)}</td><td>$${group(48000 + index * 9125)}</td></tr>`).join("");
  return `<html dir="${locale === "ar" ? "rtl" : "ltr"}" lang="${locale}"><body style="font-family: -apple-system, Helvetica; font-size: 12pt; color: #1d1d1f">
<h1>${escape(report.title)}</h1><p style="color: #6e6e73">${escape(report.intro)}</p>
<h2>${escape(report.tableHeading)}</h2>
<table border="1" cellpadding="6" cellspacing="0" width="100%"><tr>${report.columns.map(column => `<th>${escape(column)}</th>`).join("")}</tr>${rows}</table>
${report.sections.map(section => `<h2>${escape(section.heading)}</h2><p>${escape(section.body)}</p>`).join("\n")}
<p style="color: #6e6e73; font-size: 9pt">${escape(report.footer)}</p></body></html>`;
}

/** The page's size as printed (orientation applied), rounded to points, for the screen and its testIDs. */
export function orientedSize(setup: PageSetup) {
  const { width, height } = setup.paperSize;
  return setup.orientation === "landscape" ? [Math.round(height), Math.round(width)] as const : [Math.round(width), Math.round(height)] as const;
}

/** Fixed key order, so flows can compare results as text (native JSON key order is not fixed). */
const canonical = ({ paperSize, orientation, margins }: PageSetup) => ({ paperSize: { width: paperSize.width, height: paperSize.height }, orientation, margins: { top: margins.top, right: margins.right, bottom: margins.bottom, left: margins.left } });
const shown = (value: unknown) => {
  if (!value || typeof value !== "object") return value;
  if ("orientation" in value) return canonical(value as PageSetup);
  if ("numberOfPages" in value) { const { numberOfPages, pageSetup } = value as ExportPDFResult; return { numberOfPages, pageSetup: canonical(pageSetup) }; }
  return "pageSetup" in value ? { canceled: false, pageSetup: canonical((value as { pageSetup: PageSetup }).pageSetup) } : value;
};
const describe = (value: unknown) => value instanceof SparkError ? `SparkError:${value.code}` : value instanceof Error ? `Error: ${value.message}` : JSON.stringify(shown(value) ?? null);

/**
 * The persisted page setup, every print and export action, and the launch export. Each result is
 * kept as JSON (or SparkError:<code>) for the screen and its flows.
 */
export function usePrintingDemo(t: PrintingMessages, locale: Locale, card: RefObject<View | null>) {
  const [pageSetup, setPageSetup] = useState<PageSetup>();
  const [results, setResults] = useState<Partial<Record<DemoId, string>>>({});
  const [exported, setExported] = useState<Partial<Record<ExportKind, ExportPDFResult>>>({});
  const record = useCallback((id: DemoId, value: unknown) => setResults(current => ({ ...current, [id]: describe(value) })), []);
  const keep = useCallback(async (setup: PageSetup) => {
    setPageSetup(setup);
    await settings.set(SETTING, setup as never);
  }, []);
  const report = useCallback((): PrintContent => ({ type: "html", html: reportHTML(t, locale) }), [t, locale]);
  const exportContent = useCallback(async (kind: ExportKind, path: string, setup: PageSetup) => {
    const content: PrintContent = kind === "report" ? report() : kind === "window" ? { type: "window", windowId: "main" } : { type: "view", view: card.current! };
    const result = await exportPDF(content, path, { pageSetup: setup, title: t.report.title });
    setExported(current => ({ ...current, [kind]: result }));
    return result;
  }, [report, t, card]);

  useEffect(() => {
    let active = true;
    (async () => {
      const stored = await settings.get(SETTING);
      const setup = (stored as PageSetup | undefined) ?? APP_PAGE_SETUP;
      if (!active) return;
      setPageSetup(setup);
      const args = (await app.getAppContext()).launchArguments;
      const folder = args.includes(EXPORT_FLAG) ? args[args.indexOf(EXPORT_FLAG) + 1] : undefined;
      // The launch export always uses the app default, so its output does not depend on saved state.
      if (!folder) return;
      for (const kind of ["report", "window", "card"] as const) {
        const result = await exportContent(kind, `${folder}/${kind}.pdf`, APP_PAGE_SETUP);
        if (!active) return;
        if (kind === "report") record("export", result);
      }
    })().catch(error => { if (active) record("export", error); });
    return () => { active = false; };
    // The launch export runs once, with the strings of the first render.
  }, []);

  const run = useCallback(async (id: DemoId) => {
    if (!pageSetup) return;
    const printWith = async (content: PrintContent) => {
      const result = await print(content, { pageSetup, windowId: "main", title: t.report.title });
      if (!result.canceled) await keep(result.pageSetup);
      return result;
    };
    try {
      switch (id) {
        case "page-setup": {
          const result = await showPageSetup({ pageSetup, windowId: "main" });
          if (!result.canceled) await keep(result.pageSetup);
          return record(id, result);
        }
        case "system-default": {
          const setup = await getDefaultPageSetup();
          await keep(setup);
          return record(id, setup);
        }
        case "print-report": return record(id, await printWith(report()));
        case "print-window": return record(id, await printWith({ type: "window", windowId: "main" }));
        case "print-card": return record(id, await printWith({ type: "view", view: card.current! }));
        case "export": {
          const destination = await saveFileDialog({ defaultName: t.saveTitle, filters: [{ name: "PDF", extensions: ["pdf"] }], windowId: "main" });
          return record(id, destination.canceled ? destination : await exportContent("report", destination.path, pageSetup));
        }
      }
    } catch (error) {
      record(id, error);
    }
  }, [pageSetup, t, report, keep, exportContent, record, card]);

  return { pageSetup, results, exported, run };
}
