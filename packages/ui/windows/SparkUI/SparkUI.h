#pragma once
#include "NativeModules.h"
#include "SparkAppearance.h"
#include <algorithm>
#include <vector>
#include <winrt/Microsoft.ReactNative.Composition.h>
#include <winrt/Microsoft.UI.Xaml.h>
#include <winrt/Microsoft.UI.Xaml.Controls.h>
#include <winrt/Microsoft.UI.Xaml.Controls.Primitives.h>
#include <winrt/Microsoft.UI.Xaml.Hosting.h>
#include <winrt/Microsoft.UI.Xaml.Automation.h>
#include <winrt/Windows.Data.Json.h>

namespace winrt::SparkUI {
namespace React = Microsoft::ReactNative;
namespace Composition = Microsoft::ReactNative::Composition;
namespace Xaml = Microsoft::UI::Xaml;
namespace Json = Windows::Data::Json;
struct Props : implements<Props, React::IComponentProps> {
  React::ViewProps view{nullptr};
  std::string title, defaultText, text, itemsJson = "[]", value, variant = "default";
  bool disabled = false, controlled = false;
  int32_t eventCount = 0;
  void SetProp(uint32_t, hstring const &name, React::IJSValueReader const &reader) noexcept {
    if (name == L"title") React::ReadValue(reader, title);
    else if (name == L"defaultText") React::ReadValue(reader, defaultText);
    else if (name == L"text") React::ReadValue(reader, text);
    else if (name == L"controlled") React::ReadValue(reader, controlled);
    else if (name == L"eventCount") React::ReadValue(reader, eventCount);
    else if (name == L"itemsJson") React::ReadValue(reader, itemsJson);
    else if (name == L"value") React::ReadValue(reader, value);
    else if (name == L"variant") React::ReadValue(reader, variant);
    else if (name == L"disabled") React::ReadValue(reader, disabled);
  }
};
struct Control : implements<Control, Windows::Foundation::IInspectable> {
  Xaml::XamlIsland island{nullptr};
  Xaml::Controls::Control control{nullptr};
  React::EventEmitter emitter{nullptr};
  React::ReactContext context;
  weak_ref<Composition::ContentIslandComponentView> component;
  Composition::ComponentView::ThemeChanged_revoker windowThemeChanged;
  React::ReactNotificationSubscription themeSubscription;
  Windows::UI::ViewManagement::UISettings systemSettings;
  Windows::UI::ViewManagement::UISettings::ColorValuesChanged_revoker systemChanged;
  void ApplyTheme() {
    if (!control || !failure.empty()) return;
    try {
      auto view = component.get(); Windows::UI::Color color{};
      const bool override = view && view.Theme().TryGetPlatformColor(L"SparkWindowTheme", color) && color.A == 255;
      control.RequestedTheme((override ? color.R != 0 : EffectiveTheme(context)) ? Xaml::ElementTheme::Dark : Xaml::ElementTheme::Light);
    }
    catch (hresult_error const &error) { failure = to_string(error.message()); Emit(L"unavailable", "message", failure); }
  }
  std::string kind, failure, items;
  std::vector<std::string> values;
  bool initialized = false, updating = false;
  int32_t eventCount = 0;
  void Emit(hstring const &name, std::string const &key = "", std::string const &value = "") {
    const auto count = eventCount;
    if (emitter) emitter.DispatchEvent(name, [key, value, name, count](React::IJSValueWriter const &writer) {
      writer.WriteObjectBegin();
      if (!key.empty()) { writer.WritePropertyName(to_hstring(key)); writer.WriteString(to_hstring(value)); }
      if (name == L"textChange") { writer.WritePropertyName(L"eventCount"); writer.WriteInt64(count); }
      writer.WriteObjectEnd();
    });
  }
  void Create(Composition::ContentIslandComponentView const &view, std::string type) {
    kind = std::move(type); component = make_weak(view);
    try {
      // Retain one XAML environment for the UI thread, including across Fast Refresh.
      static thread_local auto manager = Xaml::Hosting::WindowsXamlManager::InitializeForCurrentThread();
      island = Xaml::XamlIsland();
      const auto weak = get_weak();
      windowThemeChanged = view.ThemeChanged(auto_revoke, [weak](auto const &, auto const &) { if (auto self = weak.get()) self->ApplyTheme(); });
      if (kind == "Button") {
        Xaml::Controls::Button button;
        button.Click([weak](auto const &, auto const &) { if (auto self = weak.get()) self->Emit(L"buttonPress"); });
        control = button;
      } else if (kind == "TextInput") {
        Xaml::Controls::TextBox input;
        input.TextChanged([weak](auto const &sender, auto const &) {
          if (auto self = weak.get(); self && !self->updating && self->control.IsEnabled()) { ++self->eventCount; self->Emit(L"textChange", "text", to_string(sender.template as<Xaml::Controls::TextBox>().Text())); }
        });
        control = input;
      } else {
        Xaml::Controls::ComboBox select;
        select.SelectionChanged([weak](auto const &sender, auto const &) {
          if (auto self = weak.get(); self && !self->updating) {
            const auto index = sender.template as<Xaml::Controls::ComboBox>().SelectedIndex();
            if (index >= 0 && static_cast<size_t>(index) < self->values.size()) self->Emit(L"selectionChange", "value", self->values[index]);
          }
        });
        control = select;
      }
      control.HorizontalAlignment(Xaml::HorizontalAlignment::Stretch);
      control.VerticalAlignment(Xaml::VerticalAlignment::Stretch);
      context = React::ReactContext(view.ReactContext());
      ApplyTheme();
      themeSubscription = context.Notifications().Subscribe(ThemeChanged(), context.UIDispatcher(), [weak](auto const &, auto const &) {
        if (auto self = weak.get()) self->ApplyTheme();
      });
      // Controls also follow the OS when no JS code has requested Appearance yet.
      systemChanged = systemSettings.ColorValuesChanged(auto_revoke, [weak, dispatcher = context.UIDispatcher()](auto const &, auto const &) {
        dispatcher.Post([weak]() { if (auto self = weak.get()) self->ApplyTheme(); });
      });
      island.Content(control);
      view.Connect(island.ContentIsland());
      ApplyTheme();
    } catch (hresult_error const &error) { failure = to_string(error.message()); }
  }
  void Update(Props const &props) {
    if (!control || !failure.empty()) return;
    try {
      updating = true;
      control.IsEnabled(!props.disabled);
      Xaml::Automation::AutomationProperties::SetAutomationId(control, props.view.TestId());
      Xaml::Automation::AutomationProperties::SetName(control, props.view.AccessibilityLabel().empty() && kind == "Button" ? to_hstring(props.title) : props.view.AccessibilityLabel());
      if (kind == "Button") {
        auto button = control.as<Xaml::Controls::Button>();
        button.Content(box_value(to_hstring(props.title)));
        // WinUI owns hover, pressed, keyboard, disabled, and accessibility states.
        button.BorderThickness(props.variant == "borderless" ? Xaml::Thickness{0, 0, 0, 0} : Xaml::Thickness{1, 1, 1, 1});
      } else if (kind == "TextInput") {
        auto input = control.as<Xaml::Controls::TextBox>();
        if (!initialized) input.Text(to_hstring(props.defaultText));
        if (props.controlled && props.eventCount >= eventCount && input.Text() != to_hstring(props.text)) input.Text(to_hstring(props.text));
      } else {
        auto select = control.as<Xaml::Controls::ComboBox>();
        if (items != props.itemsJson) {
          select.Items().Clear(); values.clear();
          for (auto const &item : Json::JsonArray::Parse(to_hstring(props.itemsJson))) {
            auto option = item.GetObject();
            select.Items().Append(box_value(option.GetNamedString(L"label")));
            values.push_back(to_string(option.GetNamedString(L"value")));
          }
          items = props.itemsJson;
        }
        auto found = std::find(values.begin(), values.end(), props.value);
        select.SelectedIndex(found == values.end() ? -1 : static_cast<int32_t>(found - values.begin()));
      }
      initialized = true; updating = false;
    } catch (hresult_error const &error) { updating = false; failure = to_string(error.message()); Emit(L"unavailable", "message", failure); }
  }
  void Close() noexcept {
    themeSubscription.Unsubscribe(); systemChanged.revoke();
    try { if (island) island.Close(); } catch (...) {}
    island = nullptr; control = nullptr; emitter = nullptr;
  }
};
inline void RegisterControls(React::IReactPackageBuilder const &package) {
  auto fabric = package.as<React::IReactPackageBuilderFabric>();
  for (const auto *kind : {"Button", "TextInput", "Select"}) {
    fabric.AddViewComponent(to_hstring(std::string("Spark") + kind), [type = std::string(kind)](React::IReactViewComponentBuilder const &builder) {
      builder.SetCreateProps([](React::ViewProps const &view, React::IComponentProps const &previous) {
        auto props = make_self<Props>();
        if (previous) {
          auto old = get_self<Props>(previous);
          props->title = old->title; props->defaultText = old->defaultText; props->itemsJson = old->itemsJson;
          props->text = old->text; props->controlled = old->controlled; props->eventCount = old->eventCount;
          props->value = old->value; props->variant = old->variant; props->disabled = old->disabled;
        }
        props->view = view; return props.as<React::IComponentProps>();
      });
      builder.as<Composition::IReactCompositionViewComponentBuilder>().SetContentIslandComponentViewInitializer([type](Composition::ContentIslandComponentView const &view) {
        auto state = make_self<Control>(); state->Create(view, type); view.UserData(state.as<Windows::Foundation::IInspectable>());
        auto weak = state->get_weak();
        view.Destroying([weak](auto const &, auto const &) { if (auto self = weak.get()) self->Close(); });
        view.LayoutMetricsChanged([weak](auto const &, React::LayoutMetricsChangedArgs const &args) {
          if (auto self = weak.get(); self && self->control) {
            auto frame = args.NewLayoutMetrics().Frame;
            self->control.Width(frame.Width); self->control.Height(frame.Height);
          }
        });
      });
      builder.SetUpdatePropsHandler([](React::ComponentView const &view, React::IComponentProps const &props, React::IComponentProps const &) {
        get_self<Control>(view.UserData())->Update(*get_self<Props>(props));
      });
      builder.SetUpdateEventEmitterHandler([](React::ComponentView const &view, React::EventEmitter const &emitter) {
        auto state = get_self<Control>(view.UserData()); state->emitter = emitter;
        if (!state->failure.empty()) state->Emit(L"unavailable", "message", state->failure);
      });
    });
  }
}
}
