#pragma once
#include "NativeModules.h"
#include <SparkBinaryWindows.hpp>
#include <winrt/Windows.ApplicationModel.DataTransfer.h>
#include <winrt/Windows.Data.Json.h>
#include <winrt/Windows.Data.Html.h>
#include <winrt/Windows.Storage.h>
#include <winrt/Windows.Storage.Streams.h>
#include <winrt/Windows.Graphics.Imaging.h>
#include <winrt/Windows.Security.Cryptography.h>
#include <richedit.h>
#include <algorithm>
namespace winrt::SparkClipboard {
namespace React = Microsoft::ReactNative;
namespace Transfer = Windows::ApplicationModel::DataTransfer;
namespace Json = Windows::Data::Json;
namespace Streams = Windows::Storage::Streams;
namespace Imaging = Windows::Graphics::Imaging;
using Windows::Security::Cryptography::CryptographicBuffer;
inline hstring PlainRTF(hstring const &rtf) {
  static const auto library = LoadLibraryW(L"Msftedit.dll"); if (!library) throw_last_error();
  auto window = CreateWindowExW(0, MSFTEDIT_CLASS, L"", ES_MULTILINE, 0, 0, 0, 0, HWND_MESSAGE, nullptr, GetModuleHandleW(nullptr), nullptr);
  if (!window) throw_last_error();
  struct Input { std::string bytes; size_t offset = 0; } input{to_string(rtf)};
  EDITSTREAM stream{}; stream.dwCookie = reinterpret_cast<DWORD_PTR>(&input);
  stream.pfnCallback = [](DWORD_PTR cookie, LPBYTE buffer, LONG size, LONG *read) -> DWORD {
    auto &value = *reinterpret_cast<Input *>(cookie); *read = static_cast<LONG>(std::min(static_cast<size_t>(size), value.bytes.size() - value.offset));
    memcpy(buffer, value.bytes.data() + value.offset, *read); value.offset += *read; return 0;
  };
  SendMessageW(window, EM_STREAMIN, SF_RTF, reinterpret_cast<LPARAM>(&stream));
  auto size = GetWindowTextLengthW(window); std::wstring text(size + 1, L'\0'); GetWindowTextW(window, text.data(), size + 1); DestroyWindow(window);
  if (stream.dwError) throw hresult_invalid_argument(L"Invalid clipboard RTF"); text.resize(size); return hstring(text);
}
inline hstring HTML(hstring const &text) {
  std::wstring value = L"<div>";
  for (auto c : text) { switch(c) { case L'&': value += L"&amp;"; break; case L'<': value += L"&lt;"; break; case L'>': value += L"&gt;"; break; case L'\n': value += L"<br>"; break; default: value += c; } }
  return hstring(value + L"</div>");
}
class ClipboardBytes final : public spark::binary::jsi::MutableBuffer {
  com_array<uint8_t> bytes;
public:
  explicit ClipboardBytes(com_array<uint8_t> value) : bytes(std::move(value)) {}
  size_t size() const override { return bytes.size(); }
  uint8_t *data() override { return bytes.data(); }
};
REACT_MODULE(SparkClipboard, L"NativeDesktopClipboard")
struct SparkClipboard {
  React::ReactContext context;
  REACT_INIT(Initialize) void Initialize(React::ReactContext const &value) noexcept { context = value; }
  static fire_and_forget Invoke(std::string method, std::string encoded, spark::binary::NativePromise promise, std::optional<std::vector<uint8_t>> input = {}, bool binary = false) {
    try {
      auto args = Json::JsonObject::Parse(to_hstring(encoded));
      if (method == "write" || method == "setString") {
        if (method != "write") {
          Json::JsonObject content; content.SetNamedValue(args.GetNamedString(L"format", L"plainText") == L"html" ? L"html" : L"text", args.GetNamedValue(L"text")); args = content;
        }
        Transfer::DataPackage data;
        if (args.HasKey(L"text")) data.SetText(args.GetNamedString(L"text"));
        if (args.HasKey(L"html")) {
          auto html = args.GetNamedString(L"html"); data.SetHtmlFormat(Transfer::HtmlFormatHelper::CreateHtmlFormat(html));
          if (!args.HasKey(L"text")) data.SetText(Windows::Data::Html::HtmlUtilities::ConvertToText(html));
        }
        if (args.HasKey(L"rtf")) { data.SetRtf(args.GetNamedString(L"rtf")); if (!args.HasKey(L"text") && !args.HasKey(L"html")) data.SetText(PlainRTF(args.GetNamedString(L"rtf"))); }
        if (args.HasKey(L"files")) {
          auto items = single_threaded_vector<Windows::Storage::IStorageItem>();
          for (auto const &entry : args.GetNamedArray(L"files")) {
            auto path = entry.GetString(); auto attributes = GetFileAttributesW(path.c_str()); if (attributes == INVALID_FILE_ATTRIBUTES) throw_last_error();
            if (attributes & FILE_ATTRIBUTE_DIRECTORY) items.Append(co_await Windows::Storage::StorageFolder::GetFolderFromPathAsync(path));
            else items.Append(co_await Windows::Storage::StorageFile::GetFileFromPathAsync(path));
          }
          data.SetStorageItems(items); data.RequestedOperation(Transfer::DataPackageOperation::Copy);
        }
        if (input) {
          auto bytes = CryptographicBuffer::CreateFromByteArray(*input);
          Streams::InMemoryRandomAccessStream stream; co_await stream.WriteAsync(bytes); stream.Seek(0);
          auto decoder = co_await Imaging::BitmapDecoder::CreateAsync(stream);
          if (decoder.DecoderInformation().CodecId() != Imaging::BitmapDecoder::PngDecoderId()) throw hresult_invalid_argument(L"Clipboard image must be PNG");
          data.SetBitmap(Streams::RandomAccessStreamReference::CreateFromStream(stream));
        }
        bool written = true;
        if (args.Size() == 0) Transfer::Clipboard::Clear();
        else { Transfer::Clipboard::SetContent(data); written = Transfer::Clipboard::Flush(); }
        // setString mirrors Expo's boolean result; write keeps reporting failure by exception only.
        promise.Resolve(method == "setString" ? (written ? "true" : "false") : "null");
      } else if (method == "clear") { Transfer::Clipboard::Clear(); promise.Resolve("null"); }
      else {
        auto data = Transfer::Clipboard::GetContent();
        const bool text = data.Contains(Transfer::StandardDataFormats::Text()), html = data.Contains(Transfer::StandardDataFormats::Html()), rtf = data.Contains(Transfer::StandardDataFormats::Rtf());
        if (method == "hasString") promise.Resolve((text || html || rtf) ? "true" : "false");
        else if (method == "formats") { Json::JsonArray formats; for (auto const &format : data.AvailableFormats()) formats.Append(Json::JsonValue::CreateStringValue(format)); promise.Resolve(to_string(formats.Stringify())); }
        else if (method == "getString") {
          hstring value; const bool preferHTML = args.GetNamedString(L"format", L"plainText") == L"html";
          if (preferHTML && html) value = Transfer::HtmlFormatHelper::GetStaticFragment(co_await data.GetHtmlFormatAsync());
          else {
            if (text) value = co_await data.GetTextAsync();
            else if (html) value = Windows::Data::Html::HtmlUtilities::ConvertToText(Transfer::HtmlFormatHelper::GetStaticFragment(co_await data.GetHtmlFormatAsync()));
            else if (rtf) value = PlainRTF(co_await data.GetRtfAsync());
            if (preferHTML && !value.empty()) value = HTML(value);
          }
          promise.Resolve(to_string(Json::JsonValue::CreateStringValue(value).Stringify()));
        } else if (method == "read") {
          Json::JsonObject result; std::shared_ptr<ClipboardBytes> image;
          if (text) result.SetNamedValue(L"text", Json::JsonValue::CreateStringValue(co_await data.GetTextAsync()));
          if (html) result.SetNamedValue(L"html", Json::JsonValue::CreateStringValue(Transfer::HtmlFormatHelper::GetStaticFragment(co_await data.GetHtmlFormatAsync())));
          if (rtf) result.SetNamedValue(L"rtf", Json::JsonValue::CreateStringValue(co_await data.GetRtfAsync()));
          if (data.Contains(Transfer::StandardDataFormats::StorageItems())) {
            Json::JsonArray files; for (auto const &item : co_await data.GetStorageItemsAsync()) files.Append(Json::JsonValue::CreateStringValue(item.Path()));
            result.SetNamedValue(L"files", files);
          }
          if (data.Contains(Transfer::StandardDataFormats::Bitmap())) {
            auto reference = co_await data.GetBitmapAsync(); auto stream = co_await reference.OpenReadAsync();
            auto decoder = co_await Imaging::BitmapDecoder::CreateAsync(stream);
            auto bitmap = co_await decoder.GetSoftwareBitmapAsync(Imaging::BitmapPixelFormat::Bgra8, Imaging::BitmapAlphaMode::Premultiplied);
            Streams::InMemoryRandomAccessStream output; auto encoder = co_await Imaging::BitmapEncoder::CreateAsync(Imaging::BitmapEncoder::PngEncoderId(), output);
            encoder.SetSoftwareBitmap(bitmap); co_await encoder.FlushAsync(); output.Seek(0);
            if (output.Size() > UINT32_MAX) throw hresult_invalid_argument(L"Clipboard image is too large");
            Streams::Buffer bytes(static_cast<uint32_t>(output.Size())); auto read = co_await output.ReadAsync(bytes, bytes.Capacity(), Streams::InputStreamOptions::None);
            com_array<uint8_t> owned; CryptographicBuffer::CopyToByteArray(read, owned); image = std::make_shared<ClipboardBytes>(std::move(owned));
          }
          spark::binary::Response response{to_string(result.Stringify()), {}, {}}; if (image) response.fields["imagePNG"] = image; promise.Resolve(std::move(response));
        } else throw hresult_invalid_argument(L"Unsupported Windows clipboard operation");
      }
    } catch (hresult_error const &error) { promise.Reject(React::ReactError{"E_CLIPBOARD", to_string(error.message())}); }
  }
  REACT_SYNC_METHOD(installBinary) std::optional<std::string> installBinary() noexcept {
    try {
    spark::binary::Install(context, "__sparkClipboardBinary", [context = context](std::string method, std::string encoded, std::optional<std::vector<uint8_t>> bytes, spark::binary::Completion finish) {
      context.UIDispatcher().Post([method = std::move(method), encoded = std::move(encoded), bytes = std::move(bytes), promise = spark::binary::NativePromise(finish)]() mutable { Invoke(std::move(method), std::move(encoded), promise, std::move(bytes), true); });
    });
      return std::nullopt;
    } catch (std::exception const &error) { return error.what(); }
    catch (hresult_error const &error) { return to_string(error.message()); }
    catch (...) { return "Could not install native binary transport"; }
  }

  REACT_METHOD(call) void call(std::string method, std::string args, React::ReactPromise<std::string> promise) noexcept {
    context.UIDispatcher().Post([method = std::move(method), args = std::move(args), promise]() { Invoke(method, args, promise); });
  }
};
}
