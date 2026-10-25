// Shared by the compiler invocation and runtime cache fingerprint.
export const macOSReleaseSettings = [
  "DEPLOYMENT_POSTPROCESSING=YES",
  "DEAD_CODE_STRIPPING=YES",
  "LLVM_LTO=YES_THIN",
  "GCC_OPTIMIZATION_LEVEL=z",
  // ld (ld-27037, Xcode 27) gives _objc_msgSend two GOT slots and, from identical inputs, assigns the fast Objective-C
  // selector stubs and other references to them in a varying order, so two links of the same objects differ. With
  // small stubs every link is identical; they are also smaller, as the size-optimized release asks.
  "OTHER_LDFLAGS=$(inherited) -Wl,-objc_stubs_small",
];
