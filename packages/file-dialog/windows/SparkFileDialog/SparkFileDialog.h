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
        HWND parent = nullptr;
        if (args.HasKey(L"windowId")) {
          struct Search { std::wstring property; HWND found = nullptr; } search{L"Spark.Window." + std::wstring(args.GetNamedString(L"windowId"))};
          EnumWindows([](HWND hwnd, LPARAM value) -> BOOL {
            auto search = reinterpret_cast<Search *>(value); DWORD process = 0; GetWindowThreadProcessId(hwnd, &process);
            if (process == GetCurrentProcessId() && GetPropW(hwnd, search->property.c_str())) { search->found = hwnd; return FALSE; }
            return TRUE;
          }, reinterpret_cast<LPARAM>(&search));
          parent = search.found;
          if (!parent) { promise.Reject(React::ReactError{"E_NOT_FOUND", "Dialog owner does not exist"}); return; }
          if (!IsWindowEnabled(parent)) { promise.Reject(React::ReactError{"E_BUSY", "Dialog owner already has a modal operation"}); return; }
        }
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
        std::wstring suggestedName = args.GetNamedString(L"defaultName", L"");
        if (!directory.empty()) {
          std::wstring value(directory);
          if (value.rfind(L"file:", 0) == 0) { wchar_t buffer[32768]; DWORD length = 32768; check_hresult(PathCreateFromUrlW(value.c_str(), buffer, &length, 0)); value = buffer; }
          // defaultPath may name a file for save dialogs: a live directory starts the
          // panel; otherwise the last component suggests defaultName and the parent starts it.
          if (save && GetFileAttributesW(value.c_str()) == INVALID_FILE_ATTRIBUTES) {
            auto parsed = std::filesystem::path(value);
            auto parent = parsed.parent_path();
            if (suggestedName.empty()) suggestedName = parsed.filename().wstring();
            if (!parent.empty()) value = parent.wstring();
          }
          auto folder = FilePath(to_string(value)); com_ptr<IShellItem> item;
          check_hresult(SHCreateItemFromParsingName(folder.c_str(), nullptr, IID_PPV_ARGS(item.put())));
          check_hresult(dialog->SetFolder(item.get()));
        }
        if (save) check_hresult(dialog->SetFileName(suggestedName.empty() ? L"Untitled.txt" : suggestedName.c_str()));
        // Windows presents one labeled filter group per filter, like Electron;
        // hosts without per-filter labels read the flattened allowedFileTypes.
        std::vector<std::wstring> labels, patterns;
        if (args.HasKey(L"filters")) for (auto const &item : args.GetNamedArray(L"filters")) {
          auto filter = item.GetObject();
          std::wstring pattern;
          for (auto const &extension : filter.GetNamedArray(L"extensions")) { if (!pattern.empty()) pattern += L";"; pattern += L"*." + std::wstring(extension.GetString()); }
          if (pattern.empty()) continue;
          labels.push_back(filter.HasKey(L"name") ? std::wstring(filter.GetNamedString(L"name")) : std::wstring(L"Supported files"));
          patterns.push_back(pattern);
        }
        else if (args.HasKey(L"allowedFileTypes")) {
          std::wstring pattern;
          for (auto const &item : args.GetNamedArray(L"allowedFileTypes")) { if (!pattern.empty()) pattern += L";"; pattern += L"*." + std::wstring(item.GetString()); }
          if (!pattern.empty()) { labels.push_back(L"Supported files"); patterns.push_back(pattern); }
        }
        std::vector<COMDLG_FILTERSPEC> filterSpecs;
        for (size_t index = 0; index < patterns.size(); ++index) filterSpecs.push_back(COMDLG_FILTERSPEC{labels[index].c_str(), patterns[index].c_str()});
        if (!filterSpecs.empty()) check_hresult(dialog->SetFileTypes(static_cast<UINT>(filterSpecs.size()), filterSpecs.data()));
        auto status = dialog->Show(parent);
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
