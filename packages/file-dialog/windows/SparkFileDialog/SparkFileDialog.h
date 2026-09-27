#pragma once
#include "NativeModules.h"
#include <shobjidl.h>
#include <shlobj.h>
#include <shlwapi.h>
#pragma comment(lib, "Shell32.lib")
#pragma comment(lib, "Shlwapi.lib")
#include <winrt/Windows.Data.Json.h>
#include <filesystem>
#include <vector>
#pragma comment(lib, "Ole32.lib")
namespace winrt::SparkFileDialog {
namespace React = Microsoft::ReactNative;
namespace Json = Windows::Data::Json;
inline std::filesystem::path FilePath(std::string const &value) {
  std::filesystem::path result(to_hstring(value).c_str());
  if (!result.is_absolute() || value.find('\0') != std::string::npos) throw hresult_invalid_argument(L"Expected an absolute file path");
  return result;
}
REACT_MODULE(SparkFileDialog, L"NativeFileDialog")
struct SparkFileDialog {
  React::ReactContext context;
  REACT_INIT(Initialize)
  void Initialize(React::ReactContext const &value) noexcept { context = value; }
  REACT_METHOD(open)
  void open(std::string options, React::ReactPromise<std::string> promise) noexcept { Pick(false, options, promise); }
  REACT_METHOD(save)
  void save(std::string options, React::ReactPromise<std::string> promise) noexcept { Pick(true, options, promise); }
  void Pick(bool save, std::string options, React::ReactPromise<std::string> promise) {
    context.UIDispatcher().Post([save, options, promise]() {
      try {
        auto args = Json::JsonObject::Parse(to_hstring(options));
        com_ptr<IFileDialog> dialog;
        check_hresult(CoCreateInstance(save ? CLSID_FileSaveDialog : CLSID_FileOpenDialog, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(dialog.put())));
        DWORD flags{}; check_hresult(dialog->GetOptions(&flags));
        flags |= FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST;
        flags |= save ? FOS_OVERWRITEPROMPT : FOS_FILEMUSTEXIST;
        if (!save && args.GetNamedBoolean(L"canChooseDirectories", false)) flags |= FOS_PICKFOLDERS;
        if (!save && args.GetNamedBoolean(L"allowsMultipleSelection", false)) flags |= FOS_ALLOWMULTISELECT;
        check_hresult(dialog->SetOptions(flags));
        const auto title = args.GetNamedString(L"title", L""); if (!title.empty()) check_hresult(dialog->SetTitle(title.c_str()));
        const auto prompt = args.GetNamedString(L"prompt", L""); if (!prompt.empty()) check_hresult(dialog->SetOkButtonLabel(prompt.c_str()));
        const auto message = args.GetNamedString(L"message", L"");
        if (!message.empty()) { auto custom = dialog.as<IFileDialogCustomize>(); check_hresult(custom->AddText(100, message.c_str())); }
        auto directory = args.GetNamedString(save ? L"directory" : L"directoryURL", L"");
        if (!directory.empty()) {
          std::wstring value(directory);
          if (value.rfind(L"file:", 0) == 0) { wchar_t buffer[32768]; DWORD length = 32768; check_hresult(PathCreateFromUrlW(value.c_str(), buffer, &length, 0)); value = buffer; }
          auto folder = FilePath(to_string(value)); com_ptr<IShellItem> item;
          check_hresult(SHCreateItemFromParsingName(folder.c_str(), nullptr, IID_PPV_ARGS(item.put())));
          check_hresult(dialog->SetFolder(item.get()));
        }
        const auto name = args.GetNamedString(L"defaultName", L"Untitled.txt"); if (save) check_hresult(dialog->SetFileName(name.c_str()));
        std::vector<std::wstring> patterns;
        if (args.HasKey(L"allowedFileTypes")) for (auto const &item : args.GetNamedArray(L"allowedFileTypes")) patterns.push_back(L"*." + std::wstring(item.GetString()));
        std::wstring pattern;
        for (auto const &item : patterns) { if (!pattern.empty()) pattern += L";"; pattern += item; }
        COMDLG_FILTERSPEC filter{L"Supported files", pattern.c_str()};
        if (!pattern.empty()) check_hresult(dialog->SetFileTypes(1, &filter));
        auto status = dialog->Show(GetActiveWindow());
        if (status == HRESULT_FROM_WIN32(ERROR_CANCELLED)) { promise.Resolve("null"); return; }
        check_hresult(status);
        auto pathFor = [](IShellItem *item) {
          PWSTR raw = nullptr; check_hresult(item->GetDisplayName(SIGDN_FILESYSPATH, &raw));
          hstring value(raw); CoTaskMemFree(raw); return Json::JsonValue::CreateStringValue(value);
        };
        if (save) { com_ptr<IShellItem> item; check_hresult(dialog->GetResult(item.put())); promise.Resolve(to_string(pathFor(item.get()).Stringify())); }
        else {
          com_ptr<IShellItemArray> items; check_hresult(dialog.as<IFileOpenDialog>()->GetResults(items.put()));
          DWORD count{}; check_hresult(items->GetCount(&count)); Json::JsonArray result;
          for (DWORD i = 0; i < count; ++i) { com_ptr<IShellItem> item; check_hresult(items->GetItemAt(i, item.put())); result.Append(pathFor(item.get())); }
          promise.Resolve(to_string(result.Stringify()));
        }
      } catch (hresult_error const &error) { promise.Reject(React::ReactError{"E_DIALOG", to_string(error.message())}); }
    });
  }
};
}
