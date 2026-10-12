#import "SparkStack.h"
#import <dlfcn.h>
#import <mach/mach.h>

#if defined(__arm64__)
// The user address space is 47 bits; higher bits of a saved return address carry its pointer-authentication code.
static const uintptr_t kAddressMask = 0x00007FFFFFFFFFFFULL;
#else
static const uintptr_t kAddressMask = UINTPTR_MAX;
#endif

static BOOL ReadMemory(uintptr_t address, void *buffer, size_t size) {
  vm_size_t read = 0;
  return vm_read_overwrite(mach_task_self(), address, size, (vm_address_t)buffer, &read) == KERN_SUCCESS && read == size;
}

size_t SparkWalkStack(uintptr_t pc, uintptr_t fp, uintptr_t lr, uintptr_t *frames, size_t capacity, size_t *linkFrame) {
  size_t n = 0;
  *linkFrame = SIZE_MAX;
  if (!capacity) return 0;
  lr &= kAddressMask;
  frames[n++] = pc & kAddressMask;
  while (n < capacity && fp && !(fp % sizeof(uintptr_t))) {
    uintptr_t record[2]; // { caller's frame pointer, return address }
    if (!ReadMemory(fp, record, sizeof record)) break;
    uintptr_t returnAddress = record[1] & kAddressMask;
    // A leaf function (a system call stub, for one) pushes no frame: its caller is only in the link register.
    // In a function that did push a frame the register may hold a stale address; SparkSymbolicate drops it then.
    if (lr && n == 1 && lr != returnAddress) { *linkFrame = n; frames[n++] = lr; }
    if (!returnAddress || n == capacity) break;
    frames[n++] = returnAddress;
    if (record[0] <= fp) break; // Frames move toward the stack base; anything else is corrupt.
    fp = record[0];
  }
  return n;
}

NSString *SparkHex(uintptr_t value) { return [NSString stringWithFormat:@"0x%lx", (unsigned long)value]; }

BOOL SparkImageUUIDBytes(const struct mach_header_64 *header, uint8_t uuid[16]) {
  if (header->magic != MH_MAGIC_64) return NO;
  const struct load_command *command = (const struct load_command *)(header + 1);
  for (uint32_t index = 0; index < header->ncmds; index++) {
    if (command->cmd == LC_UUID) { memcpy(uuid, ((const struct uuid_command *)command)->uuid, 16); return YES; }
    command = (const struct load_command *)((const char *)command + command->cmdsize);
  }
  return NO;
}

NSString *SparkImageUUID(const struct mach_header_64 *header) {
  uint8_t uuid[16];
  return SparkImageUUIDBytes(header, uuid) ? [[NSUUID alloc] initWithUUIDBytes:uuid].UUIDString : nil;
}

void SparkAddSymbol(NSMutableDictionary *frame, uintptr_t address, BOOL returnAddress) {
  Dl_info info;
  // A return address follows its call; the call itself is what belongs to the calling function.
  if (!dladdr((const void *)(returnAddress ? address - 1 : address), &info) || !info.dli_sname || !info.dli_saddr) return;
  frame[@"symbol"] = @(info.dli_sname);
  frame[@"symbolOffset"] = @(address - (uintptr_t)info.dli_saddr);
}

BOOL SparkIsStaleLinkFrame(uintptr_t link, uintptr_t running) {
  Dl_info linkInfo, runningInfo;
  return dladdr((const void *)(link - 1), &linkInfo) && dladdr((const void *)running, &runningInfo) && linkInfo.dli_saddr && linkInfo.dli_saddr == runningInfo.dli_saddr;
}

// Image, offset and UUID locate each frame for offline symbolication (atos -l <imageAddress>);
// symbol is the nearest symbol dladdr knows, which a stripped binary may lack.
NSArray<NSDictionary *> *SparkSymbolicate(const uintptr_t *frames, size_t count, size_t linkFrame) {
  NSMutableArray *stack = [NSMutableArray arrayWithCapacity:count];
  NSMutableDictionary<NSNumber *, NSString *> *uuids = [NSMutableDictionary new];
  for (size_t index = 0; index < count; index++) {
    uintptr_t address = frames[index];
    // A link register pointing back into the function that is running is a stale return address of its own calls, not its caller.
    if (index == linkFrame && SparkIsStaleLinkFrame(address, frames[0])) continue;
    NSMutableDictionary *frame = [NSMutableDictionary dictionaryWithObject:SparkHex(address) forKey:@"address"];
    Dl_info info;
    if (dladdr((const void *)(index ? address - 1 : address), &info) && info.dli_fbase) {
      uintptr_t base = (uintptr_t)info.dli_fbase;
      if (info.dli_fname) frame[@"image"] = @(info.dli_fname);
      frame[@"imageAddress"] = SparkHex(base);
      frame[@"imageOffset"] = @(address - base);
      NSNumber *key = @(base);
      if (!uuids[key]) uuids[key] = SparkImageUUID((const struct mach_header_64 *)info.dli_fbase) ?: @"";
      if (uuids[key].length) frame[@"imageUUID"] = uuids[key];
      SparkAddSymbol(frame, address, index > 0);
    }
    [stack addObject:frame];
  }
  return stack;
}
