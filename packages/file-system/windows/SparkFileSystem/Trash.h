#pragma once
#include <shobjidl.h>
#include <shellapi.h>
#include <filesystem>
#include <wrl.h>
#include <thread>
#include <exception>

namespace winrt::SparkFileSystem {
// The shell can choose permanent deletion even when recycling was requested.
// Veto that choice before any deletion, including on network/removable volumes.
struct RecycleGuard final : ::Microsoft::WRL::RuntimeClass<::Microsoft::WRL::RuntimeClassFlags<::Microsoft::WRL::ClassicCom>, IFileOperationProgressSink> {
  HRESULT result = E_ABORT;
  bool completed = false;
  IFACEMETHODIMP PreDeleteItem(DWORD flags, IShellItem *) override { return (flags & TSF_DELETE_RECYCLE_IF_POSSIBLE) ? S_OK : E_ABORT; }
  IFACEMETHODIMP PostDeleteItem(DWORD, IShellItem *, HRESULT status, IShellItem *) override { result = status; completed = true; return S_OK; }
  IFACEMETHODIMP StartOperations() override { return S_OK; }
  IFACEMETHODIMP FinishOperations(HRESULT) override { return S_OK; }
  IFACEMETHODIMP UpdateProgress(UINT, UINT) override { return S_OK; }
  IFACEMETHODIMP ResetTimer() override { return S_OK; }
  IFACEMETHODIMP PauseTimer() override { return S_OK; }
  IFACEMETHODIMP ResumeTimer() override { return S_OK; }
  IFACEMETHODIMP PreRenameItem(DWORD, IShellItem *, LPCWSTR) override { return E_NOTIMPL; }
  IFACEMETHODIMP PostRenameItem(DWORD, IShellItem *, LPCWSTR, HRESULT, IShellItem *) override { return E_NOTIMPL; }
  IFACEMETHODIMP PreMoveItem(DWORD, IShellItem *, IShellItem *, LPCWSTR) override { return E_NOTIMPL; }
  IFACEMETHODIMP PostMoveItem(DWORD, IShellItem *, IShellItem *, LPCWSTR, HRESULT, IShellItem *) override { return E_NOTIMPL; }
  IFACEMETHODIMP PreCopyItem(DWORD, IShellItem *, IShellItem *, LPCWSTR) override { return E_NOTIMPL; }
  IFACEMETHODIMP PostCopyItem(DWORD, IShellItem *, IShellItem *, LPCWSTR, HRESULT, IShellItem *) override { return E_NOTIMPL; }
  IFACEMETHODIMP PreNewItem(DWORD, IShellItem *, LPCWSTR) override { return E_NOTIMPL; }
  IFACEMETHODIMP PostNewItem(DWORD, IShellItem *, LPCWSTR, LPCWSTR, DWORD, HRESULT, IShellItem *) override { return E_NOTIMPL; }
};
inline void Trash(std::filesystem::path const &path) {
  std::exception_ptr failure;
  std::thread sta([&] {
    auto initialized = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    if (FAILED(initialized)) { failure = std::make_exception_ptr(hresult_error(initialized)); return; }
    try {
      com_ptr<IFileOperation> operation;
      check_hresult(CoCreateInstance(CLSID_FileOperation, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(operation.put())));
      check_hresult(operation->SetOperationFlags(FOF_SILENT | FOF_NOCONFIRMATION | FOF_NOERRORUI | FOF_ALLOWUNDO | FOFX_RECYCLEONDELETE | FOFX_EARLYFAILURE));
      com_ptr<IShellItem> item;
      check_hresult(SHCreateItemFromParsingName(path.c_str(), nullptr, IID_PPV_ARGS(item.put())));
      auto guard = ::Microsoft::WRL::Make<RecycleGuard>();
      check_hresult(operation->DeleteItem(item.get(), guard.Get()));
      check_hresult(operation->PerformOperations());
      BOOL aborted = FALSE; check_hresult(operation->GetAnyOperationsAborted(&aborted));
      if (aborted || !guard->completed) throw hresult_error(E_ABORT, L"Item could not be recycled; permanent deletion was refused");
      check_hresult(guard->result);
    } catch (...) { failure = std::current_exception(); }
    CoUninitialize();
  });
  sta.join(); if (failure) std::rethrow_exception(failure);
}
}
