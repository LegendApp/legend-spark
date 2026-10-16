import { useLayoutEffect, useReducer, useRef } from "react";
import { createInputValue } from "./value";

export function useInputValue(value: string, setValue: (value: string) => void, onChangeText: (value: string) => void) {
  const state = useRef<ReturnType<typeof createInputValue> | null>(null);
  if (!state.current) state.current = createInputValue(value);
  const [, render] = useReducer((version: number) => version + 1, 0);
  useLayoutEffect(() => state.current!.synchronize(value, setValue));
  return (next: string) => {
    state.current!.change(next);
    onChangeText(next);
    render();
  };
}
