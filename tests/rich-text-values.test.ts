import { describe, expect, test, vi } from "vitest";
import { createInputValue } from "../packages/rich-text/src/value";

describe("controlled rich text values", () => {
  test.each(["  **👩🏽‍💻 café**\n\n- item\n", "<p> <strong>👩🏽‍💻 café</strong>&amp; </p>"])(
    "round-trips %s without trimming or reserializing",
    (value) => {
      const state = createInputValue("");
      expect(state.change(value)).toBe(value);
      const replace = vi.fn();
      state.synchronize(value, replace);
      expect(replace).not.toHaveBeenCalled();
    },
  );

  test("a native echo leaves the clicked caret and undo history alone", () => {
    const native = { text: "**Hello** café", caret: 8, undo: ["Hello"] };
    const replace = vi.fn((text: string) => {
      native.text = text;
      native.caret = 0;
      native.undo = [];
    });
    const state = createInputValue(native.text);
    state.change("**Hello** cafés");
    state.synchronize("**Hello** cafés", replace);
    expect(native.caret).toBe(8);
    expect(native.undo).toEqual(["Hello"]);
    expect(replace).not.toHaveBeenCalled();
  });

  test("external replacement is applied once", () => {
    const state = createInputValue("first"),
      replace = vi.fn();
    state.synchronize("second", replace);
    state.synchronize("second", replace);
    expect(replace.mock.calls).toEqual([["second"]]);
  });

  test("a rejected native edit restores the controlled value", () => {
    const state = createInputValue("first"),
      replace = vi.fn();
    state.change("rejected");
    state.synchronize("first", replace);
    expect(replace).toHaveBeenCalledWith("first");
  });
});
