import { defineScreens } from "../../shell/registry";
import { Speech } from "./Speech";
import { Video } from "./Video";

export default defineScreens("media", [
  { id: "video", title: "Video", summary: "A silent test clip played by AVFoundation: play, pause, exact seek, rate, volume and mute with their status events, fullscreen and picture in picture.", component: Video },
  { id: "speech", title: "Speech", summary: "Text to speech with rate, pitch, volume and word-boundary events, pause, resume and stop; speech recognition with permissions, partial results, on-device recognition and cancel.", component: Speech },
]);
