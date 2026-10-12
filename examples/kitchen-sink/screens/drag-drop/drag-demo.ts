import { useState } from "react";
import { SparkError } from "@legendapp/spark/contracts";
import { getDragDropAvailability, type DragEndEvent, type DropEvent, type PromisedFileWriteRequest, type SpringLoadHighlight } from "@legendapp/spark/drag-drop";
import { writeText } from "@legendapp/spark/files";

/** Availability readouts, keyed by the testID suffix that shows them. */
export function dragAvailability() {
  return {
    module: getDragDropAvailability(), "promised-files": getDragDropAvailability("promisedFiles"), "spring-loading": getDragDropAvailability("springLoading"),
    "drag-image": getDragDropAvailability("dragImage"), "operation-masks": getDragDropAvailability("operationMasks"),
  };
}
export const PROMISED_FILE = "Spark Notes.txt";
export const PROMISED_TEXT = "Written by the Spark Kitchen Sink when a folder accepted the drag.\n";
// A system image every Mac has, so the file image source needs no bundled asset.
export const DOCUMENT_ICON = "/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/GenericDocumentIcon.icns";
export const MISSING_IMAGE = "/nonexistent/spark-drag-image.png";

const describe = (value: unknown) => value instanceof SparkError ? `SparkError:${value.code}` : value instanceof Error ? `Error: ${value.message}` : String(value);
const ended = (event: DragEndEvent) => event.accepted ? event.operation : "none";

/** The Drag & drop features screen's state: what each source and target reports. */
export function useDragDemo() {
  const [written, setWritten] = useState<string[]>([]);
  const [ends, setEnds] = useState<Record<string, string>>({});
  const [dropped, setDropped] = useState<string | null>(null);
  const [springs, setSprings] = useState(0);
  const [highlights, setHighlights] = useState<SpringLoadHighlight[]>([]);
  const [springDropped, setSpringDropped] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const source = (id: string) => ({
    onDragEnd: (event: DragEndEvent) => setEnds(previous => ({ ...previous, [id]: ended(event) })),
    onError: (error: SparkError) => setLastError(`${id}: ${describe(error)}`),
  });
  return {
    written, ends, dropped, springs, highlights, springDropped, lastError, source,
    /** Writes the promised file where the destination asked: for Finder, the folder it was dropped in. */
    writePromised: async ({ name, path }: PromisedFileWriteRequest) => { await writeText(path, PROMISED_TEXT); setWritten(previous => [...previous, name]); },
    onOpsDrop: (event: DropEvent) => setDropped(`${event.operation} · allowed ${(event.allowedOperations ?? []).join(",")}`),
    onSpringLoad: () => setSprings(count => count + 1),
    onSpringHighlight: ({ highlight }: { highlight: SpringLoadHighlight }) => setHighlights(previous => [...previous, highlight]),
    onSpringDrop: (event: DropEvent) => setSpringDropped(`${event.operation} · ${event.text ?? ""}`),
    onTargetError: (error: SparkError) => setLastError(`target: ${describe(error)}`),
  };
}
