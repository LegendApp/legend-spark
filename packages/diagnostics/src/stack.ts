/** One frame of a stack. Image, offset and UUID locate it for offline symbolication. */
export interface StackFrame {
  /** The program counter (first frame) or a return address, as hex. */
  address: string;
  /** The loaded binary that contains the address. Absent for an address outside every image (JIT code, a corrupt frame). */
  image?: string;
  /** The image's load address, as hex: `atos -o <image> -l <imageAddress> <address>`. */
  imageAddress?: string;
  /** `address` minus `imageAddress`. */
  imageOffset?: number;
  /** The image's LC_UUID, to match a dSYM. */
  imageUUID?: string;
  /** The nearest symbol the dynamic loader knows. Stripped release builds may name a neighbour or nothing; symbolicate those with the dSYM. */
  symbol?: string;
  symbolOffset?: number;
}

export const isFrame = (value: unknown): value is StackFrame => {
  if (!value || typeof value !== "object") return false;
  const frame = value as Record<string, unknown>;
  const optional = (key: string, type: "string" | "number") => frame[key] === undefined || typeof frame[key] === type;
  return typeof frame.address === "string" && optional("image", "string") && optional("imageAddress", "string") && optional("imageOffset", "number")
    && optional("imageUUID", "string") && optional("symbol", "string") && optional("symbolOffset", "number");
};
