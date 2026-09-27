import { expect, test } from "vitest";
import { dragConfiguration, dragSource, dragDrop, dragEnd, dragPosition } from "../packages/drag-drop/src/contracts.ts";
test("drag contracts preserve generic built-in payloads and explicit move/custom data", () => {
  expect(JSON.parse(dragConfiguration({ text: "text" }, {}, "macos"))).toEqual({ sourceOperations: ["copy"], acceptedOperations: ["copy"], acceptedTypes: ["files", "text", "urls"] });
  expect(JSON.parse(dragConfiguration({ data: { "application/x-playlist": '{"id":42}' } }, { sourceOperations: ["copy", "move"], acceptedOperations: ["move"], acceptedTypes: ["application/x-playlist"] }, "windows"))).toMatchObject({ acceptedOperations: ["move"], acceptedTypes: ["application/x-playlist"] });
  expect(() => dragConfiguration({ files: [String.raw`C:\Music\track.mp3`] }, {}, "windows")).not.toThrow();
});
test("drag contracts reject ambiguous operations and invalid custom representations", () => {
  for (const operations of [["delete"], ["move", "move"]]) expect(() => dragConfiguration(undefined, { sourceOperations: operations as never }, "macos")).toThrow();
  for (const type of ["bad format", "application/x-spark-drag", "text/plain", "text/uri-list"]) expect(() => dragConfiguration({ data: { [type]: "data" } }, {}, "macos")).toThrow();
  expect(() => dragConfiguration({ data: { "application/x-item": {} as never } }, {}, "macos")).toThrow();
  expect(() => dragConfiguration({ files: ["relative.txt"] }, {}, "macos")).toThrow("absolute");
  expect(JSON.parse(dragConfiguration(undefined, { acceptedOperations: [], acceptedTypes: [] }, "macos"))).toMatchObject({ acceptedOperations: [], acceptedTypes: [] });
});

test("source validation normalizes and snapshots owned fields", () => {
  const source = { files: ["file:///tmp/one%20two"], data: { "application/x-item": "{\"id\":1}" } };
  const snapshot = dragSource(source, "macos"); source.files.push("/tmp/other");
  expect(snapshot?.files).toEqual(["/tmp/one two"]);
  expect(() => dragSource({ urls: ["https://one", "https://two"] }, "windows")).toThrow(expect.objectContaining({ code: "E_UNSUPPORTED_OPTION" }));
  for (const value of [null, [], {}, { files: null }, { files: "x" }, { files: ["/x\0y"] }, { urls: ["https://a b"] }, { data: null }, { text: false }]) {
    expect(() => dragSource(value as never, "macos")).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
  }
  expect(() => dragSource({ tracks: [] } as never, "macos")).toThrow(expect.objectContaining({ code: "E_UNSUPPORTED_OPTION" }));
  expect(() => dragConfiguration(undefined, { acceptedTypes: ["text", "text"] }, "macos")).toThrow();
});
test("native payloads reject malformed fields and strip transport details", () => {
  const event = { x: -2, y: 30, operation: "move", text: "hello", private: 1 };
  expect(dragDrop(JSON.stringify(event), "macos")).toEqual({ x: -2, y: 30, operation: "move", text: "hello" });
  expect(dragPosition(JSON.stringify(event))).toEqual({ x: -2, y: 30, operation: "move" });
  expect(dragDrop(JSON.stringify({ x: 1, y: 2, operation: "copy", urls: ["https://one", "https://two"] }), "windows").urls).toHaveLength(2);
  for (const change of [{ x: null }, { operation: "none" }, { files: {} }, { text: null }, { data: { "text/plain": "x" } }]) {
    expect(() => dragDrop(JSON.stringify({ ...event, ...change }), "macos")).toThrow(expect.objectContaining({ code: "E_INVALID_DATA" }));
  }
  expect(() => dragDrop("not json", "macos")).toThrow(expect.objectContaining({ code: "E_INVALID_DATA" }));
  expect(dragEnd('{"accepted":false,"operation":"none"}')).toEqual({ accepted: false, operation: "none" });
  expect(() => dragEnd('{"accepted":false,"operation":"move"}')).toThrow();
});
