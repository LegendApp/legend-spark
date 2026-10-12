import { defineScreens } from "../../shell/registry";
import { Capture } from "./Capture";
import { CAPTURE_MESSAGES } from "./capture-messages";
import { Speech } from "./Speech";
import { Video } from "./Video";

export default defineScreens("media", [
  { id: "video", title: "Video", summary: "A silent test clip played by AVFoundation: play, pause, exact seek, rate, volume and mute with their status events, fullscreen and picture in picture.", component: Video },
  { id: "speech", title: "Speech", summary: "Text to speech with rate, pitch, volume and word-boundary events, pause, resume and stop; speech recognition with permissions, partial results, on-device recognition and cancel.", component: Speech },
  { id: "capture", title: "Capture", titles: { ar: CAPTURE_MESSAGES.ar.title }, summary: "Microphone recording with levels, the camera with a live preview and photos, and screen capture: displays and windows, screenshots and screen recording. Never prompts; simulated devices in test runs.", component: Capture },
]);
