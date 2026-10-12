// Source map v3 for the DevTools checks (scripts/test-devtools.ts, scripts/test-profiler.ts): generated [line, column] <->
// [source, line], lines and columns from 0.
export function sourceMap(map: { sources: string[]; mappings: string }) {
  const digits = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const segments: { line: number; column: number; source: number; sourceLine: number }[] = [];
  let source = 0, sourceLine = 0, sourceColumn = 0;
  map.mappings.split(";").forEach((text, line) => {
    let column = 0;
    for (const segment of text.split(",").filter(Boolean)) {
      const values: number[] = [];
      for (let i = 0, value = 0, shift = 0; i < segment.length; i++) {
        const digit = digits.indexOf(segment[i]!);
        value += (digit & 31) << shift;
        if (digit & 32) { shift += 5; continue; }
        values.push(value & 1 ? -(value >>> 1) : value >>> 1); value = 0; shift = 0;
      }
      column += values[0]!;
      if (values.length < 4) continue;
      source += values[1]!; sourceLine += values[2]!; sourceColumn += values[3]!;
      segments.push({ line, column, source, sourceLine });
    }
  });
  return {
    generated(file: string, line: number) { return segments.find(item => map.sources[item.source]!.endsWith(file) && item.sourceLine === line); },
    original(line: number, column: number) {
      const item = segments.filter(entry => entry.line === line && entry.column <= column).at(-1);
      return item && { source: map.sources[item.source]!, line: item.sourceLine };
    },
  };
}
