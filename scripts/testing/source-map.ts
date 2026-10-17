// Source map v3 for the DevTools checks (scripts/test-devtools.ts, scripts/test-profiler.ts) and the driver's bundle
// server's /symbolicate (scripts/e2e/bundle-server.ts): generated [line, column] <-> [source, line, column], lines and
// columns from 0.
/** `source` is -1 for a segment that maps to no source (it ends the previous segment's mapping). */
type Segment = { column: number; source: number; sourceLine: number; sourceColumn: number };

export function sourceMap(map: { sources: string[]; mappings: string }) {
  const digits = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  // Segments by generated line, in column order (the mappings list them that way).
  const lines: Segment[][] = [];
  let source = 0, sourceLine = 0, sourceColumn = 0;
  map.mappings.split(";").forEach((text, line) => {
    let column = 0;
    const segments: Segment[] = lines[line] = [];
    for (const segment of text.split(",").filter(Boolean)) {
      const values: number[] = [];
      for (let i = 0, value = 0, shift = 0; i < segment.length; i++) {
        const digit = digits.indexOf(segment[i]!);
        value += (digit & 31) << shift;
        if (digit & 32) { shift += 5; continue; }
        values.push(value & 1 ? -(value >>> 1) : value >>> 1); value = 0; shift = 0;
      }
      column += values[0]!;
      if (values.length < 4) { segments.push({ column, source: -1, sourceLine: -1, sourceColumn: -1 }); continue; }
      source += values[1]!; sourceLine += values[2]!; sourceColumn += values[3]!;
      segments.push({ column, source, sourceLine, sourceColumn });
    }
  });
  return {
    generated(file: string, line: number) {
      for (const [index, segments] of lines.entries()) {
        const item = segments.find(entry => entry.source >= 0 && map.sources[entry.source]!.endsWith(file) && entry.sourceLine === line);
        if (item) return { line: index, column: item.column };
      }
      return undefined;
    },
    /** The source position of the last segment at or before `column` on `line`; undefined when none covers it. */
    original(line: number, column: number) {
      const item = lines[line]?.filter(entry => entry.column <= column).at(-1);
      return item && item.source >= 0 ? { source: map.sources[item.source]!, line: item.sourceLine, column: item.sourceColumn } : undefined;
    },
  };
}
