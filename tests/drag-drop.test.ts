import { expect, test } from "vitest";
import { dragConfiguration, dragOptions, dragSource, dragDrop, dragEnd, dragPosition, promisedFileRequest, springLoadHighlight } from "../packages/drag-drop/src/contracts.ts";
test("drag contracts preserve generic built-in payloads and explicit move/custom data", () => {
  expect(JSON.parse(dragConfiguration({ text: "text" }, {}, "macos"))).toEqual({ sourceOperations: ["copy"], externalOperations: ["copy"], acceptedOperations: ["copy"], acceptedTypes: ["files", "text", "urls"], ignoreModifierKeys: false, springLoading: false });
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

test("promised files are named files with optional MIME types, macOS only", () => {
  expect(dragSource({ promisedFiles: [{ name: "Notes.txt" }, { name: "data", type: "application/json" }] }, "macos")).toEqual({ promisedFiles: [{ name: "Notes.txt" }, { name: "data", type: "application/json" }] });
  for (const promisedFiles of [[], [{ name: "" }], [{ name: "a/b" }], [{ name: ".." }], [{ name: "a:b" }], [{ name: "x", type: "text" }], [{ name: "x", extra: 1 }], [{ name: "x" }, { name: "x" }], "x"]) {
    expect(() => dragSource({ promisedFiles } as never, "macos")).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
  }
  expect(() => dragSource({ promisedFiles: [{ name: "Notes.txt" }] }, "windows")).toThrow(expect.objectContaining({ code: "E_UNSUPPORTED_PLATFORM" }));
  // Incoming payloads never carry promised files.
  expect(() => dragDrop(JSON.stringify({ x: 0, y: 0, operation: "copy", promisedFiles: [] }), "macos")).not.toThrow();
  expect(dragDrop(JSON.stringify({ x: 0, y: 0, operation: "copy", promisedFiles: [{ name: "x" }] }), "macos")).not.toHaveProperty("promisedFiles");
  expect(promisedFileRequest('{"id":3,"name":"Notes.txt","path":"/tmp/Notes.txt","extra":1}')).toEqual({ id: 3, name: "Notes.txt", path: "/tmp/Notes.txt" });
  for (const json of ['{"id":1.5,"name":"x","path":"/x"}', '{"id":1,"name":"x","path":"x"}', '{"id":1,"path":"/x"}']) expect(() => promisedFileRequest(json)).toThrow(expect.objectContaining({ code: "E_INVALID_DATA" }));
});
test("drag images, contextual operations, modifier keys and spring loading are validated and macOS only", () => {
  const options = (value: object, platform = "macos") => JSON.parse(dragOptions(value, platform));
  expect(options({ dragImage: "view" }).dragImage).toBe("view");
  expect(options({ dragImage: { path: "file:///tmp/a%20b.png", width: 64, height: 48 } }).dragImage).toEqual({ path: "/tmp/a b.png", width: 64, height: 48 });
  for (const dragImage of ["snapshot", { path: "/x.png", width: 0, height: 4 }, { path: "relative.png", width: 4, height: 4 }, { path: "/x.png", width: 4 }, { path: "/x.png", width: 4, height: 4, x: 1 }]) {
    expect(() => options({ dragImage })).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
  }
  expect(options({ sourceOperations: { withinApp: ["move", "copy"], outsideApp: ["copy"] } })).toMatchObject({ sourceOperations: ["move", "copy"], externalOperations: ["copy"] });
  expect(options({ tearOff: true })).toMatchObject({ tearOff: true });
  expect(options({ tearOff: false })).not.toHaveProperty("tearOff");
  expect(() => options({ tearOff: "yes" })).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
  expect(() => options({ tearOff: true }, "windows")).toThrow(expect.objectContaining({ code: "E_UNSUPPORTED_PLATFORM" }));
  expect(options({ sourceOperations: ["link"], ignoreModifierKeys: true, springLoading: true })).toMatchObject({ sourceOperations: ["link"], externalOperations: ["link"], ignoreModifierKeys: true, springLoading: true });
  for (const value of [{ sourceOperations: { withinApp: ["copy"] } }, { sourceOperations: { withinApp: ["copy"], outsideApp: ["copy"], other: [] } }, { ignoreModifierKeys: "yes" }, { springLoading: 1 }]) {
    expect(() => options(value)).toThrow(expect.objectContaining({ code: "E_INVALID_ARGUMENT" }));
  }
  for (const value of [{ dragImage: "view" }, { sourceOperations: { withinApp: ["copy"], outsideApp: ["copy"] } }, { ignoreModifierKeys: true }, { springLoading: true }]) {
    expect(() => options(value, "windows")).toThrow(expect.objectContaining({ code: "E_UNSUPPORTED_PLATFORM" }));
  }
  // Explicitly off is the Windows behavior, not an unsupported request.
  expect(options({ ignoreModifierKeys: false, springLoading: false }, "windows")).toMatchObject({ ignoreModifierKeys: false, springLoading: false });
  expect(() => options({ springloading: true })).toThrow(expect.objectContaining({ code: "E_UNSUPPORTED_OPTION" }));
});
test("native events carry the modifier-narrowed operations and the spring-loading highlight", () => {
  expect(dragPosition('{"x":1,"y":2,"operation":"copy","allowedOperations":["copy"]}')).toEqual({ x: 1, y: 2, operation: "copy", allowedOperations: ["copy"] });
  expect(dragDrop('{"x":1,"y":2,"operation":"link","allowedOperations":["link"],"text":"t"}', "macos")).toEqual({ x: 1, y: 2, operation: "link", allowedOperations: ["link"], text: "t" });
  for (const allowed of ['["none"]', '"copy"', "[1]"]) expect(() => dragPosition(`{"x":1,"y":2,"operation":"copy","allowedOperations":${allowed}}`)).toThrow(expect.objectContaining({ code: "E_INVALID_DATA" }));
  expect(springLoadHighlight('{"highlight":"emphasized"}')).toEqual({ highlight: "emphasized" });
  expect(() => springLoadHighlight('{"highlight":"bright"}')).toThrow(expect.objectContaining({ code: "E_INVALID_DATA" }));
});
