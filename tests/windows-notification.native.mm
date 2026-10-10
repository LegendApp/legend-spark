#import <Foundation/Foundation.h>
#include <cassert>
#include <string>
#include <vector>

static NSString *String(std::wstring const &value) { return [[NSString alloc] initWithBytes:value.data() length:value.size() * sizeof(wchar_t) encoding:NSUTF32LittleEndianStringEncoding]; }
static std::wstring Wide(NSString *value) { NSData *bytes = [value dataUsingEncoding:NSUTF32LittleEndianStringEncoding]; return std::wstring((wchar_t const *)bytes.bytes, bytes.length / sizeof(wchar_t)); }

// Exercise the production payload builder with Foundation DOM/JSON at the WinRT boundary.
namespace Json {
struct JsonObject;
struct JsonValue {
  id value;
  static JsonValue CreateStringValue(std::wstring const &value) { return {String(value)}; }
  JsonObject GetObject() const;
};
struct JsonArray {
  std::vector<JsonValue> values;
  unsigned Size() const { return static_cast<unsigned>(values.size()); }
  auto begin() const { return values.begin(); }
  auto end() const { return values.end(); }
};
struct JsonObject {
  NSMutableDictionary *values;
  JsonObject(id value = @{}) : values([value mutableCopy]) {}
  std::wstring GetNamedString(std::wstring const &name, std::wstring const &fallback = L"") const { return values[String(name)] ? Wide(values[String(name)]) : fallback; }
  JsonArray GetNamedArray(std::wstring const &name, JsonArray fallback) const {
    if (!values[String(name)]) return fallback;
    JsonArray result; for (id value in values[String(name)]) result.values.push_back({value}); return result;
  }
  void SetNamedValue(std::wstring const &name, JsonValue const &value) { values[String(name)] = value.value; }
  std::wstring Stringify() const { return Wide([[NSString alloc] initWithData:[NSJSONSerialization dataWithJSONObject:values options:0 error:nil] encoding:NSUTF8StringEncoding]); }
  static JsonObject Parse(std::wstring const &value) { return {[NSJSONSerialization JSONObjectWithData:[String(value) dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil]}; }
};
JsonObject JsonValue::GetObject() const { return {value}; }
}
namespace Xml {
struct Node {
  NSXMLNode *value;
  void SetAttribute(std::wstring const &name, std::wstring const &text) { [(NSXMLElement *)value addAttribute:[NSXMLNode attributeWithName:String(name) stringValue:String(text)]]; }
  void AppendChild(Node const &child) { [(NSXMLElement *)value addChild:child.value]; }
};
struct XmlDocument {
  NSXMLDocument *value;
  void LoadXml(std::wstring const &text) { value = [[NSXMLDocument alloc] initWithXMLString:String(text) options:0 error:nil]; assert(value); }
  Node DocumentElement() const { return {value.rootElement}; }
  Node SelectSingleNode(std::wstring const &xpath) const { return {[[value nodesForXPath:String(xpath) error:nil] firstObject]}; }
  Node CreateElement(std::wstring const &name) { return {[NSXMLElement elementWithName:String(name)]}; }
  Node CreateTextNode(std::wstring const &text) { return {[NSXMLNode textWithStringValue:String(text)]}; }
};
}
static NSXMLDocument *Payload(Json::JsonObject const &args) {
  Json::JsonObject response(@{ @"project": @"fixture", @"notificationId": @"note", @"data": @{ @"key": @"value" }, @"action": @"open" });
// ACTUAL_PAYLOAD
  return xml.value;
}
static NSArray<NSXMLNode *> *Nodes(NSXMLDocument *xml, NSString *xpath) { return [xml nodesForXPath:xpath error:nil]; }
static NSString *Attribute(NSXMLElement *element, NSString *name) { return [element attributeForName:name].stringValue; }
static NSDictionary *Arguments(NSString *text) { return [NSJSONSerialization JSONObjectWithData:[text dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil]; }
int main() { @autoreleasepool {
  NSArray *buttons = @[@{ @"id": @"reply", @"label": @"Reply & <review>" }, @{ @"id": @"archive", @"label": @"Archive" }];
  NSDictionary *tones = @{ @"default": @"Default", @"message": @"IM", @"mail": @"Mail", @"reminder": @"Reminder", @"call": @"Looping.Call", @"error": @"Default" };
  for (NSString *sound in [@[@"none"] arrayByAddingObjectsFromArray:tones.allKeys]) {
    NSXMLDocument *xml = Payload(Json::JsonObject(@{ @"title": @"Title & <tag>", @"body": @"Body", @"sound": sound, @"actions": buttons }));
    assert(Nodes(xml, @"/toast/action").count == 0);
    assert(Nodes(xml, @"/toast/actions").count == 1);
    NSArray *actions = Nodes(xml, @"/toast/actions/action"); assert(actions.count == 2);
    for (NSUInteger i = 0; i < actions.count; ++i) {
      assert([Attribute(actions[i], @"content") isEqual:buttons[i][@"label"]]);
      NSDictionary *arguments = Arguments(Attribute(actions[i], @"arguments"));
      assert([arguments[@"action"] isEqual:buttons[i][@"id"]]);
      assert([arguments[@"notificationId"] isEqual:@"note"] && [arguments[@"data"] isEqual:@{ @"key": @"value" }]);
    }
    assert([Arguments(Attribute(xml.rootElement, @"launch"))[@"action"] isEqual:@"open"]);
    assert([[Nodes(xml, @"/toast/visual/binding/text") firstObject].stringValue isEqual:@"Title & <tag>"]);
    NSXMLElement *audio = (NSXMLElement *)Nodes(xml, @"/toast/audio").firstObject;
    assert(Attribute(audio, @"duration") == nil);
    if ([sound isEqual:@"none"]) assert([Attribute(audio, @"silent") isEqual:@"true"]);
    else assert([Attribute(audio, @"src") isEqual:[@"ms-winsoundevent:Notification." stringByAppendingString:tones[sound]]]);
    if ([sound isEqual:@"call"]) { assert([Attribute(audio, @"loop") isEqual:@"true"]); assert([Attribute(xml.rootElement, @"duration") isEqual:@"long"]); }
    else { assert(Attribute(audio, @"loop") == nil); assert(Attribute(xml.rootElement, @"duration") == nil); }
  }
  NSXMLDocument *plain = Payload(Json::JsonObject(@{ @"title": @"Plain" }));
  assert(Nodes(plain, @"/toast/actions").count == 0 && Nodes(plain, @"/toast/action").count == 0);
  assert([Attribute((NSXMLElement *)Nodes(plain, @"/toast/audio").firstObject, @"silent") isEqual:@"true"]);
  puts("Windows notification payloads passed");
} }
