// Adapted from Slides' NotesText: native value echoes must preserve selection and undo.
export function createInputValue(value: string) {
  let nativeValue = value;
  return {
    change(next: string) {
      nativeValue = next;
      return next;
    },
    synchronize(next: string, setValue: (value: string) => void) {
      if (nativeValue !== next) {
        nativeValue = next;
        setValue(next);
      }
    },
  };
}
