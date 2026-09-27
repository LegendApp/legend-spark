#pragma once
#include "NativeModules.h"
#include <winrt/Windows.Media.h>
#include <winrt/Windows.Media.Core.h>
#include <winrt/Windows.Media.Playback.h>
#include <winrt/Windows.Storage.h>
#include <winrt/Windows.Data.Json.h>
#include <map>
#include <memory>
#include <cmath>
#include <atomic>
#include <mutex>
#include <set>
#include <winrt/Windows.Storage.Streams.h>
namespace winrt::SparkAudio {
namespace React = Microsoft::ReactNative;
namespace Json = Windows::Data::Json;
struct Entry { Windows::Media::Playback::MediaPlayer player{nullptr}; std::atomic<bool> ended{false}; std::atomic<bool> failed{false}; std::atomic<bool> loaded{false}; };
struct MediaSession {
  Windows::Media::Playback::MediaPlayer player{nullptr};
  std::mutex mutex;
  std::set<std::wstring> allowed;
  Json::JsonArray commands;
  Json::JsonObject state;
  ~MediaSession() { if (player) { player.SystemMediaTransportControls().IsEnabled(false); player.Close(); } }
  void Command(hstring const &name, double position = -1) {
    std::lock_guard lock(mutex); if (!allowed.count(std::wstring(name)) || commands.Size() >= 128) return;
    Json::JsonObject value; value.SetNamedValue(L"command", Json::JsonValue::CreateStringValue(name));
    if (position >= 0) value.SetNamedValue(L"position", Json::JsonValue::CreateNumberValue(position));
    commands.Append(value);
  }
};
inline void Metadata(Windows::Media::SystemMediaTransportControls const &controls, Json::JsonObject const &metadata) {
  auto display = controls.DisplayUpdater(); display.ClearAll(); display.Type(Windows::Media::MediaPlaybackType::Music);
  display.MusicProperties().Title(metadata.GetNamedString(L"title", L""));
  display.MusicProperties().Artist(metadata.GetNamedString(L"artist", L""));
  display.MusicProperties().AlbumTitle(metadata.GetNamedString(L"albumTitle", L""));
  auto artwork = metadata.GetNamedString(L"artworkUrl", L"");
  if (!artwork.empty()) display.Thumbnail(Windows::Storage::Streams::RandomAccessStreamReference::CreateFromUri(Windows::Foundation::Uri(artwork)));
  display.Update();
}
inline void UpdateSession(std::shared_ptr<MediaSession> const &session, Json::JsonObject const &patch) {
  for (auto const &pair : patch) session->state.SetNamedValue(pair.Key(), pair.Value());
  auto state = session->state; auto controls = session->player.SystemMediaTransportControls();
  if (patch.HasKey(L"metadata")) Metadata(controls, patch.GetNamedObject(L"metadata"));
  auto status = state.GetNamedString(L"playbackState", L"stopped");
  controls.PlaybackStatus(status == L"playing" ? Windows::Media::MediaPlaybackStatus::Playing : status == L"paused" ? Windows::Media::MediaPlaybackStatus::Paused : Windows::Media::MediaPlaybackStatus::Stopped);
  auto duration = state.GetNamedNumber(L"duration", 0), position = state.GetNamedNumber(L"position", 0);
  Windows::Media::SystemMediaTransportControlsTimelineProperties timeline;
  auto span = [](double seconds) { return std::chrono::duration_cast<Windows::Foundation::TimeSpan>(std::chrono::duration<double>(seconds)); };
  timeline.StartTime(span(0)); timeline.MinSeekTime(span(0)); timeline.EndTime(span(duration)); timeline.MaxSeekTime(span(duration)); timeline.Position(span(std::min(position, duration)));
  controls.UpdateTimelineProperties(timeline);
  std::lock_guard lock(session->mutex);
  session->allowed.clear();
  if (state.HasKey(L"commands")) for (auto const &command : state.GetNamedArray(L"commands")) session->allowed.insert(std::wstring(command.GetString()));
  else session->allowed = {L"play", L"pause"};
  controls.IsPlayEnabled(session->allowed.count(L"play") != 0); controls.IsPauseEnabled(session->allowed.count(L"pause") != 0);
  controls.IsNextEnabled(session->allowed.count(L"nextTrack") != 0); controls.IsPreviousEnabled(session->allowed.count(L"previousTrack") != 0);
  controls.IsEnabled(true);
}
struct Players {
  std::map<std::string, std::shared_ptr<Entry>> values;
  std::string sessionID;
  std::shared_ptr<MediaSession> session;
  ~Players() { session.reset(); for (auto const &[id, entry] : values) { entry->player.Pause(); entry->player.Close(); } }
};
REACT_MODULE(SparkAudio, L"NativeSparkAudio")
struct SparkAudio {
  React::ReactContext context;
  std::shared_ptr<Players> players = std::make_shared<Players>();
  REACT_INIT(Initialize)
  void Initialize(React::ReactContext const &value) noexcept { context = value; }
  static fire_and_forget Invoke(std::shared_ptr<Players> players, std::string method, std::string encoded, React::ReactPromise<std::string> promise) {
    try {
      auto args = Json::JsonObject::Parse(to_hstring(encoded)); auto id = to_string(args.GetNamedString(L"id"));
      if (method.starts_with("session")) {
        if (method == "sessionCreate") {
          players->session.reset();
          for (auto const &[key, entry] : players->values) entry->player.SystemMediaTransportControls().IsEnabled(false);
          auto session = std::make_shared<MediaSession>(); session->player = Windows::Media::Playback::MediaPlayer();
          session->player.CommandManager().IsEnabled(false);
          std::weak_ptr<MediaSession> weak = session; auto controls = session->player.SystemMediaTransportControls();
          controls.ButtonPressed([weak](auto const &, auto const &event) { if (auto current = weak.lock()) {
            using Button = Windows::Media::SystemMediaTransportControlsButton;
            auto button = event.Button();
            auto name = button == Button::Play ? L"play" : button == Button::Pause ? L"pause" : button == Button::Next ? L"nextTrack" : button == Button::Previous ? L"previousTrack" : L"";
            if (*name) current->Command(name);
          } });
          controls.PlaybackPositionChangeRequested([weak](auto const &, auto const &event) { if (auto current = weak.lock()) current->Command(L"seekTo", std::chrono::duration<double>(event.RequestedPlaybackPosition()).count()); });
          players->session = session; players->sessionID = id;
          UpdateSession(session, args);
        } else {
          if ((!players->session || players->sessionID != id) && method == "sessionRemove") { promise.Resolve("null"); co_return; }
          if (!players->session || players->sessionID != id) throw hresult_invalid_argument(L"Media session has been replaced");
          if (method == "sessionUpdate") UpdateSession(players->session, args);
          else if (method == "sessionRemove") { players->session.reset(); players->sessionID.clear(); }
          else if (method == "sessionCommands") {
            std::lock_guard lock(players->session->mutex);
            auto result = to_string(players->session->commands.Stringify()); players->session->commands.Clear(); promise.Resolve(result); co_return;
          } else throw hresult_invalid_argument(L"Unknown media session operation");
        }
      } else if (method == "create") {
        auto uri = args.GetNamedString(L"uri"); Windows::Media::Core::MediaSource source{nullptr};
        if ((uri.size() > 2 && uri[1] == L':') || std::wstring(uri).starts_with(L"\\\\")) {
          auto file = co_await Windows::Storage::StorageFile::GetFileFromPathAsync(uri);
          source = Windows::Media::Core::MediaSource::CreateFromStorageFile(file);
        } else source = Windows::Media::Core::MediaSource::CreateFromUri(Windows::Foundation::Uri(uri));
        Windows::Media::Playback::MediaPlayer player; player.AutoPlay(false);
        auto controls = player.SystemMediaTransportControls(); controls.IsEnabled(!players->session); controls.IsPlayEnabled(true); controls.IsPauseEnabled(true);
        auto display = controls.DisplayUpdater(); display.Type(Windows::Media::MediaPlaybackType::Music); display.MusicProperties().Title(args.GetNamedString(L"title", L"Music")); display.Update();
        auto entry = std::make_shared<Entry>(); entry->player = player; std::weak_ptr<Entry> weak = entry;
        player.MediaEnded([weak](auto const &, auto const &) { if (auto entry = weak.lock()) entry->ended = true; });
        player.MediaFailed([weak](auto const &, auto const &) { if (auto entry = weak.lock()) entry->failed = true; });
        player.MediaOpened([weak](auto const &, auto const &) { if (auto entry = weak.lock()) entry->loaded = true; });
        player.Source(source);
        players->values.emplace(id, entry);
      } else {
        auto found = players->values.find(id);
        if (found == players->values.end() && method == "remove") { promise.Resolve("null"); co_return; }
        if (found == players->values.end()) throw hresult_invalid_argument(L"Audio player is not available");
        auto entry = found->second; auto player = entry->player; auto session = player.PlaybackSession();
        if (method == "ready") { if (entry->failed) throw hresult_error(E_FAIL, L"Audio could not be decoded or loaded"); promise.Resolve(entry->loaded ? "true" : "false"); co_return; }
        else if (method == "volume") { auto volume = args.GetNamedNumber(L"volume"); if (!std::isfinite(volume) || volume < 0 || volume > 1) throw hresult_invalid_argument(L"Invalid volume"); player.Volume(volume); }
        else if (method == "metadata") Metadata(player.SystemMediaTransportControls(), args.GetNamedObject(L"metadata"));
        else if (method == "play") { if (!players->session) player.SystemMediaTransportControls().IsEnabled(true); entry->ended = false; player.Play(); }
        else if (method == "pause") player.Pause();
        else if (method == "seek") { entry->ended = false; auto seconds = args.GetNamedNumber(L"seconds"); if (!std::isfinite(seconds) || seconds < 0) throw hresult_invalid_argument(L"Invalid seek position"); session.Position(std::chrono::duration_cast<Windows::Foundation::TimeSpan>(std::chrono::duration<double>(seconds))); }
        else if (method == "remove") { player.Pause(); player.Close(); players->values.erase(found); }
        else if (method == "status") {
          auto position = std::chrono::duration<double>(session.Position()).count(), duration = std::chrono::duration<double>(session.NaturalDuration()).count();
          Json::JsonObject status;
          status.SetNamedValue(L"volume", Json::JsonValue::CreateNumberValue(player.Volume()));
          status.SetNamedValue(L"playing", Json::JsonValue::CreateBooleanValue(session.PlaybackState() == Windows::Media::Playback::MediaPlaybackState::Playing));
          status.SetNamedValue(L"currentTime", Json::JsonValue::CreateNumberValue(position)); status.SetNamedValue(L"duration", Json::JsonValue::CreateNumberValue(duration));
          status.SetNamedValue(L"didJustFinish", Json::JsonValue::CreateBooleanValue(entry->ended.load())); status.SetNamedValue(L"error", entry->failed ? Json::JsonValue::CreateStringValue(L"Audio could not be decoded or loaded") : Json::JsonValue::CreateNullValue());
          promise.Resolve(to_string(status.Stringify())); co_return;
        } else throw hresult_invalid_argument(L"Unknown audio operation");
      }
      promise.Resolve("null");
    } catch (hresult_error const &error) { promise.Reject(React::ReactError{"E_AUDIO", to_string(error.message())}); }
    catch (std::exception const &error) { promise.Reject(error.what()); }
  }
  REACT_METHOD(call)
  void call(std::string method, std::string args, React::ReactPromise<std::string> promise) noexcept {
    context.UIDispatcher().Post([players = players, method, args, promise]() { Invoke(players, method, args, promise); });
  }
};
}
