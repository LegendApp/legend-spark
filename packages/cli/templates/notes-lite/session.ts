export type Theme = "system" | "light" | "dark";
export type Frame = { displayId: string; x: number; y: number; width: number; height: number };
export type SavedWindow = { id: string; noteId?: string; frame: Frame };
export function decodeWindows(value: unknown): SavedWindow[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every(item => item && typeof item.id === "string" && /^(main|settings|note-[a-zA-Z0-9_-]+)$/.test(item.id) && (item.noteId === undefined || typeof item.noteId === "string") && item.frame && typeof item.frame.displayId === "string" && item.frame.displayId.length > 0 && ["x", "y", "width", "height"].every(key => Number.isFinite(item.frame[key])) && item.frame.width >= 100 && item.frame.height >= 100 && item.frame.width <= 20000 && item.frame.height <= 20000) || new Set(value.map(item => item.id)).size !== value.length) throw new Error("Unsupported window session");
  return value;
}
/** Saved bounds and work areas use the same display-relative logical units. */
export function fitFrame(frame: Frame, workAreas: Frame[]): Frame {
  if (!workAreas.length) return frame;
  const area = workAreas.find(area => area.displayId === frame.displayId) ?? workAreas[0];
  const width = Math.min(frame.width, area.width), height = Math.min(frame.height, area.height);
  return { displayId: area.displayId, x: Math.max(area.x, Math.min(frame.x, area.x + area.width - width)), y: Math.max(area.y, Math.min(frame.y, area.y + area.height - height)), width, height };
}
