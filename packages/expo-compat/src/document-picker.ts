import { openFileDialog } from "@legendapp/spark-file-dialog";
import * as files from "@legendapp/spark-file-system";
import type { DocumentPickerOptions, DocumentPickerResult } from "expo-document-picker";
export type { DocumentPickerOptions, DocumentPickerAsset, DocumentPickerResult, DocumentPickerSuccessResult, DocumentPickerCanceledResult } from "expo-document-picker";

// File-dialog filters use extensions; never silently widen an unknown MIME filter.
const mimeExtensions: Record<string, string[]> = {
  "text/plain": ["txt", "text"], "text/markdown": ["md", "markdown"], "text/csv": ["csv"], "text/html": ["html", "htm"],
  "application/json": ["json"], "application/pdf": ["pdf"], "application/zip": ["zip"],
  "application/msword": ["doc"], "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
  "image/png": ["png"], "image/jpeg": ["jpg", "jpeg"], "image/gif": ["gif"], "image/webp": ["webp"],
  "image/heic": ["heic"], "image/heif": ["heif"], "image/tiff": ["tif", "tiff"], "image/bmp": ["bmp"], "image/svg+xml": ["svg"], "image/avif": ["avif"],
  "audio/mpeg": ["mp3"], "audio/wav": ["wav"], "audio/mp4": ["m4a"], "audio/aac": ["aac"], "audio/flac": ["flac"],
  "video/mp4": ["mp4", "m4v"], "video/quicktime": ["mov"], "video/webm": ["webm"],
};
let nextCopy = 0;
function invalid(message: string): never { throw Object.assign(new TypeError(message), { code: "ERR_INVALID_ARGUMENT" }); }
function unavailable(message: string): never { throw Object.assign(new Error(message), { code: "ERR_UNAVAILABLE" }); }
function filters(type: string | string[]) {
  const types = typeof type === "string" ? [type] : type;
  if (!Array.isArray(types) || !types.length || types.some(value => typeof value !== "string" || !/^[\w.+*-]+\/[\w.+*-]+$/.test(value))) invalid("Expected document MIME types");
  if (types.includes("*/*")) return undefined;
  const extensions = types.flatMap(mime => {
    if (mimeExtensions[mime]) return mimeExtensions[mime];
    if (["image/*", "audio/*", "video/*", "text/*"].includes(mime)) return Object.entries(mimeExtensions).filter(([key]) => key.startsWith(mime.slice(0, -1))).flatMap(([, values]) => values);
    return unavailable(`DocumentPicker does not support MIME filter ${mime} on macOS`);
  });
  return [{ extensions: [...new Set(extensions)] }];
}

export async function getDocumentAsync(options: DocumentPickerOptions = {}): Promise<DocumentPickerResult> {
  if (!options || typeof options !== "object" || Array.isArray(options)) invalid("Expected document picker options");
  for (const key of Object.keys(options)) if (!["type", "multiple", "copyToCacheDirectory", "base64"].includes(key)) unavailable(`Unsupported DocumentPicker option: ${key}`);
  for (const key of ["multiple", "copyToCacheDirectory", "base64"] as const) if (options[key] !== undefined && typeof options[key] !== "boolean") invalid(`${key} must be a boolean`);
  if (options.base64 === true) unavailable("DocumentPicker base64 is available only on web");
  const result = await openFileDialog({ multiple: options.multiple ?? false, filters: filters(options.type ?? "*/*") });
  if (result.canceled) return { canceled: true, assets: null };
  const cache = options.copyToCacheDirectory === false ? undefined : `${await files.getDirectory("cache")}/DocumentPicker`;
  if (cache) await files.mkdir(cache);
  const assets = [];
  for (const source of result.paths) {
    const name = source.slice(source.lastIndexOf("/") + 1);
    const info = await files.stat(source);
    if (info.type !== "file") unavailable("DocumentPicker supports regular files on macOS");
    const path = cache ? `${cache}/${Date.now()}-${++nextCopy}-${name}` : source;
    if (cache) await files.copy(source, path);
    const extension = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
    const mimeType = Object.entries(mimeExtensions).find(([, extensions]) => extensions.includes(extension))?.[0];
    assets.push({ name, uri: `file://${path.split("/").map(encodeURIComponent).join("/")}`, size: info.size, lastModified: info.modifiedAt, ...(mimeType && { mimeType }) });
  }
  return { canceled: false, assets };
}
