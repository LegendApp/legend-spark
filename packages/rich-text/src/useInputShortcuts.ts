import type { RefObject } from "react";
import type { RichTextInputRef, FormattingAction } from "./types";

export interface InputFormattingShortcuts {
  onFormat(action: FormattingAction): void;
  linkEnabled: boolean;
}

export function useInputShortcuts(
  _input: RefObject<RichTextInputRef | null>,
  _focused: boolean,
  _formatting?: InputFormattingShortcuts,
) {}
