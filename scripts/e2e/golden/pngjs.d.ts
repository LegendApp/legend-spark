// The part of pngjs 3.4 (zero dependencies, already in the lockfile through Expo's image tooling) the golden pipeline uses.
declare module "pngjs" {
  export class PNG {
    constructor(options: { width: number; height: number });
    width: number;
    height: number;
    /** 8-bit RGBA; `sync.read` converts every PNG color type and bit depth to it. */
    data: Buffer;
    static sync: { read(buffer: Buffer): PNG; write(png: PNG): Buffer };
  }
}
