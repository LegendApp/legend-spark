import { expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

test.skipIf(process.platform !== "darwin")("native audio status reads are pure and observation stops with ownership", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "spark-audio-native-"));
  try {
    const implementation = readFileSync(path.resolve(import.meta.dirname, "../packages/audio/macos/RNSparkAudio.mm"), "utf8")
      .split("\n").filter(line => !line.startsWith('#import "') && !line.startsWith("- (std::shared_ptr")).join("\n");
    const input = path.join(directory, "Audio.mm"), executable = path.join(directory, "audio");
    const wav = Buffer.alloc(44 + 16000);
    wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
    wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(16000, 40);
    writeFileSync(path.join(directory, "tone.wav"), wav);
    writeFileSync(input, `#import <Foundation/Foundation.h>
#import <AppKit/AppKit.h>
#import <AVFoundation/AVFoundation.h>
#import <MediaPlayer/MediaPlayer.h>
#include <cassert>
#define RCT_EXPORT_MODULE(name)
typedef void (^RCTPromiseResolveBlock)(id);
typedef void (^RCTPromiseRejectBlock)(NSString *, NSString *, NSError *);
@interface RCTEventEmitter : NSObject
@property NSMutableArray *events;
- (void)sendEventWithName:(NSString *)name body:(id)body;
- (void)invalidate;
@end
@implementation RCTEventEmitter
- (instancetype)init { if (self = [super init]) self.events = [NSMutableArray new]; return self; }
- (void)sendEventWithName:(NSString *)name body:(id)body { [self.events addObject:@{@"name": name, @"body": body}]; }
- (void)invalidate {}
@end
@interface RNSparkAudio : RCTEventEmitter
@end
${implementation}
@interface TestAudio : RNSparkAudio
@property NSUInteger publications;
@end
@implementation TestAudio
- (void)publishPlayer:(NSString *)identifier { self.publications += 1; }
@end
static id Call(TestAudio *audio, NSString *method, NSDictionary *args) {
  __block BOOL done = NO; __block id result = nil; __block NSString *failure = nil;
  NSString *json = [[NSString alloc] initWithData:[NSJSONSerialization dataWithJSONObject:args options:0 error:nil] encoding:NSUTF8StringEncoding];
  [audio call:method args:json resolve:^(id value) { result = value; done = YES; } reject:^(NSString *code, NSString *message, NSError *error) { failure = code; done = YES; }];
  NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:5];
  while (!done && deadline.timeIntervalSinceNow > 0) [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
  assert(done && !failure);
  return [NSJSONSerialization JSONObjectWithData:[result dataUsingEncoding:NSUTF8StringEncoding] options:NSJSONReadingFragmentsAllowed error:nil];
}
int main() { @autoreleasepool {
  TestAudio *audio = [TestAudio new];
  audio.players[@"test"] = [AVPlayer new];
  Call(audio, @"status", @{@"id": @"test"}); assert(audio.publications == 0);
  assert([audio supportedEvents].count == 2);
  Call(audio, @"statusUpdates", @{@"id": @"test", @"enabled": @YES});
  assert(audio.observations.count == 1 && audio.events.count == 1);
  SparkAudioObservation *observation = audio.observations[@"test"];
  Call(audio, @"statusUpdates", @{@"id": @"test", @"enabled": @NO});
  assert(observation.stopped && audio.observations.count == 0);
  NSUInteger delivered = audio.events.count;
  Call(audio, @"status", @{@"id": @"test"}); assert(audio.publications == 0 && audio.events.count == delivered);
  Call(audio, @"statusUpdates", @{@"id": @"test", @"enabled": @YES});
  assert(audio.events.count == delivered + 1);
  __block BOOL readinessFailed = NO;
  [audio call:@"awaitReady" args:@"{\\"id\\":\\"test\\"}" resolve:^(id value) { assert(false); } reject:^(NSString *code, NSString *message, NSError *error) { assert([code isEqualToString:@"E_CLOSED"]); readinessFailed = YES; }];
  [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
  assert(audio.readiness.count == 1 && audio.readiness[@"test"].timeObserver == nil);
  Call(audio, @"remove", @{@"id": @"test"}); assert(audio.players.count == 0 && audio.observations.count == 0);
  assert(readinessFailed && audio.readiness.count == 0 && audio.readyRejects.count == 0);
  Call(audio, @"create", @{@"id": @"loaded", @"uri": @"${directory}/tone.wav"});
  assert([Call(audio, @"awaitReady", @{@"id": @"loaded"}) boolValue]);
  assert(audio.readiness.count == 0 && audio.readyRejects.count == 0);
  NSUInteger published = audio.publications;
  NSDictionary *status = Call(audio, @"status", @{@"id": @"loaded"});
  assert([status[@"duration"] doubleValue] > 0 && audio.publications == published);
  Call(audio, @"remove", @{@"id": @"loaded"});
  [audio invalidate];
  [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.02]];
  puts("Native audio observation tests passed");
} return 0; }
`);
    execFileSync("clang++", ["-fobjc-arc", "-fblocks", "-std=c++20", "-framework", "AppKit", "-framework", "AVFoundation", "-framework", "CoreMedia", "-framework", "MediaPlayer", input, "-o", executable], { timeout: 20000 });
    expect(execFileSync(executable, { encoding: "utf8", timeout: 15000 })).toContain("Native audio observation tests passed");
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 40000);
