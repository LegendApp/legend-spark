#pragma once
#include "NativeModules.h"
#include <SparkComponentGeometry.h>
#include <cmath>
#include <map>
#include <memory>
#include <winrt/Microsoft.ReactNative.Composition.h>
#include <winrt/Microsoft.ReactNative.Composition.Input.h>
#include <winrt/Microsoft.UI.Input.DragDrop.h>
#include <winrt/Microsoft.UI.Content.h>
#include <winrt/Windows.ApplicationModel.DataTransfer.h>
#include <winrt/Windows.Storage.h>
#include <winrt/Windows.Data.Json.h>
namespace winrt::SparkDragDrop {
namespace React = Microsoft::ReactNative;
namespace Composition = Microsoft::ReactNative::Composition;
namespace Drag = Microsoft::UI::Input::DragDrop;
namespace Transfer = Windows::ApplicationModel::DataTransfer;
namespace Json = Windows::Data::Json;
using Operation = Transfer::DataPackageOperation;
inline Operation ParseOperation(hstring const &name) { return name == L"move" ? Operation::Move : name == L"link" ? Operation::Link : name == L"copy" ? Operation::Copy : Operation::None; }
inline hstring OperationName(Operation value) { return value == Operation::Move ? L"move" : value == Operation::Link ? L"link" : value == Operation::Copy ? L"copy" : L"none"; }
inline Json::JsonArray Strings(std::initializer_list<wchar_t const *> values) { Json::JsonArray result; for (auto value : values) result.Append(Json::JsonValue::CreateStringValue(value)); return result; }
using Point = Windows::Foundation::Point;
using Windows::Foundation::IAsyncAction;
using Windows::Foundation::IAsyncOperation;
struct Props : implements<Props, React::IComponentProps> {
  React::ViewProps view{nullptr}; std::string source, options = "{}"; bool disabled = false;
  void SetProp(uint32_t, hstring const &name, React::IJSValueReader const &reader) noexcept {
    if (name == L"sourceJson") React::ReadValue(reader, source); else if (name == L"optionsJson") React::ReadValue(reader, options); else if (name == L"disabled") React::ReadValue(reader, disabled);
  }
};
struct DragView;
struct RootState {
  apartment_context ui;
  weak_ref<Composition::RootComponentView> root;
  Drag::DragDropManager manager{nullptr}; event_token requested{};
  std::map<int32_t, weak_ref<DragView>> views;
  ~RootState() { if (manager) try { manager.TargetRequested(requested); } catch (...) {} }
  static React::ComponentView Find(React::ComponentView const &view, int64_t tag) {
    if (view.Tag() == tag) return view;
    for (auto const &child : view.Children()) if (auto found = Find(child, tag)) return found;
    return nullptr;
  }
  com_ptr<DragView> Target(Point point);
};
struct DragView : implements<DragView, Windows::Foundation::IInspectable> {
  weak_ref<Composition::ViewComponentView> view;
  React::EventEmitter emitter{nullptr};
  std::shared_ptr<RootState> root;
  std::string source, failure, options = "{}";
  bool disabled = false, pressed = false, dragging = false, mounted = false;
  Point origin{};
  Drag::DragOperation operation{nullptr};
  void Emit(hstring const &event, Json::JsonObject const &value = {}) {
    if (!emitter || !mounted) return;
    const auto json = value.Stringify();
    emitter.DispatchEvent(event, [json](React::IJSValueWriter const &writer) { writer.WriteObjectBegin(); writer.WritePropertyName(L"json"); writer.WriteString(json); writer.WriteObjectEnd(); });
  }
  Point Local(Point point) {
    auto strong = view.get(); if (!strong) return {};
    auto rect = strong.as<ISparkComponentGeometry>()->SparkClientRect(); auto scale = strong.LayoutMetrics().PointScaleFactor; if (scale <= 0) scale = 1;
    return {point.X - rect.left / scale, point.Y - rect.top / scale};
  }
  Json::JsonObject Options() { return Json::JsonObject::Parse(to_hstring(options.empty() ? "{}" : options)); }
  Json::JsonArray Types() { return Options().GetNamedArray(L"acceptedTypes", Strings({L"files", L"text", L"urls"})); }
  Operation Accept(Drag::DragInfo const &info) {
    if (!mounted || disabled) return Operation::None;
    auto data = info.Data(); bool supported = false;
    for (auto const &item : Types()) {
      auto type = item.GetString();
      auto format = type == L"files" ? Transfer::StandardDataFormats::StorageItems() : type == L"text" ? Transfer::StandardDataFormats::Text() : type == L"urls" ? Transfer::StandardDataFormats::WebLink() : type;
      if (data.Contains(format)) { supported = true; break; }
    }
    if (!supported) return Operation::None;
    for (auto const &name : Options().GetNamedArray(L"acceptedOperations", Strings({L"copy"}))) {
      auto operation = ParseOperation(name.GetString()); if ((info.AllowedOperations() & operation) != Operation::None) return operation;
    }
    return Operation::None;
  }
  void Fail(hresult_error const &error, bool unavailable = false) {
    if (unavailable) failure = to_string(error.message());
    Json::JsonObject value; value.SetNamedValue(L"message", Json::JsonValue::CreateStringValue(error.message()));
    value.SetNamedValue(L"unavailable", Json::JsonValue::CreateBooleanValue(unavailable)); Emit(L"error", value);
  }
  fire_and_forget Start(Microsoft::UI::Input::PointerPoint point, Composition::Input::Pointer pointer) {
    auto keepAlive = get_strong();
    Operation resultOperation = Operation::None;
    try {
      if (!root || source.empty() || disabled) throw hresult_canceled();
      auto session = root;
      operation = Drag::DragOperation(); Operation allowed = Operation::None;
      for (auto const &name : Options().GetNamedArray(L"sourceOperations", Strings({L"copy"}))) allowed = allowed | ParseOperation(name.GetString());
      operation.AllowedOperations(allowed);
      auto data = operation.Data(); auto payload = Json::JsonObject::Parse(to_hstring(source));
      data.SetData(L"application/x-spark-drag", box_value(to_hstring(source)));
      for (auto const &item : payload.GetNamedObject(L"data", Json::JsonObject())) data.SetData(item.Key(), box_value(item.Value().GetString()));
      if (payload.HasKey(L"text")) data.SetText(payload.GetNamedString(L"text"));
      if (payload.HasKey(L"urls")) { auto urls = payload.GetNamedArray(L"urls"); if (urls.Size()) data.SetWebLink(Windows::Foundation::Uri(urls.GetStringAt(0))); }
      if (payload.HasKey(L"files")) {
        auto items = single_threaded_vector<Windows::Storage::IStorageItem>();
        for (auto const &entry : payload.GetNamedArray(L"files")) {
          auto path = entry.GetString(); auto attributes = GetFileAttributesW(path.c_str()); if (attributes == INVALID_FILE_ATTRIBUTES) throw_last_error();
          if (attributes & FILE_ATTRIBUTE_DIRECTORY) items.Append(co_await Windows::Storage::StorageFolder::GetFolderFromPathAsync(path));
          else items.Append(co_await Windows::Storage::StorageFile::GetFileFromPathAsync(path));
        }
        data.SetStorageItems(items);
      }
      if (mounted && !disabled && root == session) resultOperation = co_await operation.StartAsync(session->manager, point);
    } catch (hresult_error const &error) { if (error.code() != E_ABORT && error.code() != HRESULT_FROM_WIN32(ERROR_CANCELLED)) Fail(error); }
    if (auto strong = view.get()) strong.ReleasePointerCapture(pointer);
    if (operation) { try { operation.Close(); } catch (...) {} operation = nullptr; }
    dragging = false; Json::JsonObject result; result.SetNamedValue(L"accepted", Json::JsonValue::CreateBooleanValue(resultOperation != Operation::None)); result.SetNamedValue(L"operation", Json::JsonValue::CreateStringValue(OperationName(resultOperation))); Emit(L"dragEnd", result);
  }
  void Close(bool destroy = false) noexcept {
    mounted = false; pressed = false;
    if (root) { if (auto strong = view.get()) root->views.erase(strong.Tag()); root.reset(); }
    if (operation) try { operation.Close(); } catch (...) {}
    if (destroy) emitter = nullptr;
  }
};
inline com_ptr<DragView> RootState::Target(Point point) {
  auto strong = root.get(); if (!strong) return nullptr;
  float x = 0, y = 0; auto tag = strong.as<ISparkComponentGeometry>()->SparkHitTest(point.X, point.Y, &x, &y);
  if (tag < 0) return nullptr;
  auto target = Find(strong, tag);
  while (target) {
    auto found = views.find(target.Tag());
    if (found != views.end()) if (auto state = found->second.get(); state && state->mounted && !state->disabled) return state;
    target = target.Parent();
  }
  return nullptr;
}
inline IAsyncOperation<Json::JsonObject> Payload(Drag::DragInfo info, Point point, Json::JsonArray types, Operation operation) {
  auto data = info.Data(); Json::JsonObject result;
  if (data.Contains(L"application/x-spark-drag")) result = Json::JsonObject::Parse(unbox_value<hstring>(co_await data.GetDataAsync(L"application/x-spark-drag")));
  else {
    if (data.Contains(Transfer::StandardDataFormats::Text())) result.SetNamedValue(L"text", Json::JsonValue::CreateStringValue(co_await data.GetTextAsync()));
    if (data.Contains(Transfer::StandardDataFormats::StorageItems())) { Json::JsonArray files; for (auto const &item : co_await data.GetStorageItemsAsync()) files.Append(Json::JsonValue::CreateStringValue(item.Path())); result.SetNamedValue(L"files", files); }
    if (data.Contains(Transfer::StandardDataFormats::WebLink())) { Json::JsonArray urls; urls.Append(Json::JsonValue::CreateStringValue((co_await data.GetWebLinkAsync()).AbsoluteUri())); result.SetNamedValue(L"urls", urls); }
  }
  Json::JsonObject custom;
  for (auto const &entry : types) { auto type = entry.GetString(); if (std::wstring(type).find(L'/') != std::wstring::npos && data.Contains(type)) custom.SetNamedValue(type, Json::JsonValue::CreateStringValue(unbox_value<hstring>(co_await data.GetDataAsync(type)))); }
  result.SetNamedValue(L"data", custom);
  result.SetNamedValue(L"operation", Json::JsonValue::CreateStringValue(OperationName(operation)));
  result.SetNamedValue(L"x", Json::JsonValue::CreateNumberValue(point.X)); result.SetNamedValue(L"y", Json::JsonValue::CreateNumberValue(point.Y)); co_return result;
}
struct DropTarget : implements<DropTarget, Drag::IDropOperationTarget> {
  std::shared_ptr<RootState> root; weak_ref<DragView> current;
  DropTarget(std::shared_ptr<RootState> value) : root(std::move(value)) {}
  IAsyncOperation<Operation> OverAsync(Drag::DragInfo info, Drag::DragUIOverride) {
    auto keepAlive = get_strong(); co_await root->ui;
    com_ptr<DragView> target;
    try {
      target = root->Target(info.Position());
      auto operation = target ? target->Accept(info) : Operation::None;
      if (operation == Operation::None) target = nullptr;
      auto previous = current.get();
      if (target != previous) {
        if (previous) previous->Emit(L"dragLeave"); current = target ? target->get_weak() : weak_ref<DragView>{};
        if (target) { auto payload = co_await Payload(info, target->Local(info.Position()), target->Types(), operation); if (target->mounted && !target->disabled && current.get() == target) target->Emit(L"dragEnter", payload); }
      }
      if (!target || current.get() != target || target->Accept(info) != operation) co_return Operation::None;
      const auto point = target->Local(info.Position()); Json::JsonObject over;
      over.SetNamedValue(L"x", Json::JsonValue::CreateNumberValue(point.X)); over.SetNamedValue(L"y", Json::JsonValue::CreateNumberValue(point.Y));
      over.SetNamedValue(L"operation", Json::JsonValue::CreateStringValue(OperationName(operation))); target->Emit(L"dragOver", over);
      co_return operation;
    } catch (hresult_error const &error) { if (target) target->Fail(error); co_return Operation::None; }
  }
  IAsyncOperation<Operation> EnterAsync(Drag::DragInfo info, Drag::DragUIOverride ui) { return OverAsync(info, ui); }
  IAsyncAction LeaveAsync(Drag::DragInfo) { auto keepAlive = get_strong(); co_await root->ui; if (auto previous = current.get()) previous->Emit(L"dragLeave"); current = {}; co_return; }
  IAsyncOperation<Operation> DropAsync(Drag::DragInfo info) {
    auto keepAlive = get_strong(); co_await root->ui;
    com_ptr<DragView> target;
    try {
      target = root->Target(info.Position());
      auto operation = target ? target->Accept(info) : Operation::None; if (operation == Operation::None) co_return operation;
      auto payload = co_await Payload(info, target->Local(info.Position()), target->Types(), operation);
      if (target->Accept(info) != operation) co_return Operation::None;
      target->Emit(L"drop", payload); current = {}; co_return operation;
    } catch (hresult_error const &error) { if (target) target->Fail(error); co_return Operation::None; }
  }
};
inline std::shared_ptr<RootState> ForRoot(Composition::RootComponentView const &root) {
  static thread_local std::map<int32_t, std::weak_ptr<RootState>> roots;
  if (auto existing = roots[root.Tag()].lock()) if (existing->root.get() == root) return existing;
  auto state = std::make_shared<RootState>(); state->root = root; state->manager = Drag::DragDropManager::GetForIsland(root.ReactNativeIsland().Island());
  // Fail at mount if an unpatched runtime was selected, instead of crashing on a drop.
  root.as<ISparkComponentGeometry>();
  state->requested = state->manager.TargetRequested([weak = std::weak_ptr(state)](auto const &, auto const &args) { if (auto state = weak.lock()) args.SetTarget(make<DropTarget>(state)); });
  roots[root.Tag()] = state; return state;
}
inline void Register(React::IReactPackageBuilder const &package) {
  package.as<React::IReactPackageBuilderFabric>().AddViewComponent(L"DesktopDragView", [](React::IReactViewComponentBuilder const &builder) {
    builder.SetCreateProps([](React::ViewProps const &view, React::IComponentProps const &previous) { auto props = make_self<Props>(); if (previous) { auto old = get_self<Props>(previous); props->source = old->source; props->options = old->options; props->disabled = old->disabled; } props->view = view; return props.as<React::IComponentProps>(); });
    builder.as<Composition::IReactCompositionViewComponentBuilder>().SetViewComponentViewInitializer([](Composition::ViewComponentView const &view) {
      auto state = make_self<DragView>(); state->view = view; view.UserData(state.as<Windows::Foundation::IInspectable>()); auto weak = state->get_weak();
      view.Mounted([weak](auto const &, React::ComponentView const &) { if (auto self = weak.get()) try { self->mounted = true; auto view = self->view.get(); self->root = ForRoot(view.Root()); self->root->views[view.Tag()] = self->get_weak(); } catch (hresult_error const &error) { self->Fail(error, true); } });
      view.Unmounted([weak](auto const &, auto const &) { if (auto self = weak.get()) self->Close(); });
      view.Destroying([weak](auto const &, auto const &) { if (auto self = weak.get()) self->Close(true); });
      view.PointerPressed([weak](auto const &, Composition::Input::PointerRoutedEventArgs const &args) { if (auto self = weak.get(); self && !args.Handled() && !self->disabled && !self->source.empty()) { auto point = args.GetCurrentPoint(self->view.get().Tag()); self->pressed = point.Properties().IsLeftButtonPressed(); self->origin = point.Position(); } });
      view.PointerReleased([weak](auto const &, auto const &) { if (auto self = weak.get()) self->pressed = false; });
      view.PointerMoved([weak](auto const &, Composition::Input::PointerRoutedEventArgs const &args) {
        if (auto self = weak.get(); self && self->mounted && self->root && self->pressed && !self->dragging && !self->disabled && !args.Handled()) {
          auto view = self->view.get(); auto point = args.GetCurrentPoint(view.Tag()); if (!point.Properties().IsLeftButtonPressed()) { self->pressed = false; return; }
          if (std::hypot(point.Position().X - self->origin.X, point.Position().Y - self->origin.Y) < 6) return;
          self->dragging = true; self->pressed = false; args.Handled(true); view.CapturePointer(args.Pointer()); self->Start(point.Inner(), args.Pointer());
        }
      });
    });
    builder.SetUpdatePropsHandler([](React::ComponentView const &view, React::IComponentProps const &props, React::IComponentProps const &) { auto state = get_self<DragView>(view.UserData()); auto value = get_self<Props>(props); state->source = value->source; state->options = value->options; state->disabled = value->disabled; });
    builder.SetUpdateEventEmitterHandler([](React::ComponentView const &view, React::EventEmitter const &emitter) { auto state = get_self<DragView>(view.UserData()); state->emitter = emitter; if (!state->failure.empty()) { Json::JsonObject error; error.SetNamedValue(L"message", Json::JsonValue::CreateStringValue(to_hstring(state->failure))); error.SetNamedValue(L"unavailable", Json::JsonValue::CreateBooleanValue(true)); state->Emit(L"error", error); } });
  });
}
}
