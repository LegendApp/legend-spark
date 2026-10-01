#pragma once
#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>
#include <RNDesktopApp/SparkBinaryJSI.hpp>

@protocol SparkBinaryModule <NSObject>
- (void)binaryCall:(NSString *)method args:(NSString *)json bytes:(NSData *)bytes resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject;
@end
#ifdef __cplusplus
namespace spark::binary {
class Data final : public facebook::jsi::MutableBuffer {
public:
  explicit Data(NSData *value) : value_([value isKindOfClass:NSMutableData.class] ? (NSMutableData *)value : [value mutableCopy]) {}
  size_t size() const override { return value_.length; }
  uint8_t *data() override { return static_cast<uint8_t *>(value_.mutableBytes); }
private:
  NSMutableData *__strong value_;
};
inline jsi::Value Value(jsi::Runtime &rt, id value) {
  if (!value || value == NSNull.null) return jsi::Value::null();
  if ([value isKindOfClass:NSData.class]) return Buffer(rt, std::make_shared<Data>(value));
  if ([value isKindOfClass:NSString.class]) return jsi::String::createFromUtf8(rt, [value UTF8String]);
  if ([value isKindOfClass:NSNumber.class]) { if (CFGetTypeID((__bridge CFTypeRef)value) == CFBooleanGetTypeID()) return jsi::Value([value boolValue]); return jsi::Value([value doubleValue]); }
  if ([value isKindOfClass:NSArray.class]) { jsi::Array result(rt, [value count]); size_t index = 0; for (id item in value) result.setValueAtIndex(rt, index++, Value(rt, item)); return result; }
  jsi::Object result(rt); for (NSString *key in value) result.setProperty(rt, key.UTF8String, Value(rt, value[key])); return result;
}
inline Start ObjectiveC(id<SparkBinaryModule> module) {
  return [module](std::string method, std::string json, std::optional<std::vector<uint8_t>> bytes, Completion finish) {
    NSData *input = nil;
    if (bytes && bytes->empty()) input = [NSData data];
    else if (bytes) { auto owned = new std::vector<uint8_t>(std::move(*bytes)); input = [[NSData alloc] initWithBytesNoCopy:owned->data() length:owned->size() deallocator:^(void *, NSUInteger) { delete owned; }]; }
    [module binaryCall:[NSString stringWithUTF8String:method.c_str()] args:[NSString stringWithUTF8String:json.c_str()] bytes:input
      resolve:^(id value) { finish([value](jsi::Runtime &rt) { return Value(rt, value); }, {}, {}); }
      reject:^(NSString *code, NSString *message, NSError *) { finish({}, code.UTF8String ?: "E_NATIVE", message.UTF8String ?: "Native operation failed"); }];
  };
}
template <class Spec> class Module final : public Spec {
public:
  Module(const facebook::react::ObjCTurboModule::InitParams &params) : Spec(params) { this->methodMap_["binaryCall"] = {5, nullptr}; }
protected:
  jsi::Value create(jsi::Runtime &rt, const jsi::PropNameID &name) override {
    if (name.utf8(rt) == "binaryCall") return Function(rt, this->jsInvoker_, ObjectiveC((id<SparkBinaryModule>)this->instance_));
    return Spec::create(rt, name);
  }
};
}

#endif
