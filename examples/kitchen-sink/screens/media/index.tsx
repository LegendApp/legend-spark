import { defineScreens } from "../../shell/registry";
import { Capture } from "./Capture";
import { CAPTURE_MESSAGES } from "./capture-messages";
import { Speech } from "./Speech";
import { SPEECH_MESSAGES } from "./speech-messages";
import { Video } from "./Video";
import { VIDEO_MESSAGES } from "./video-messages";

export default defineScreens("media", [
  { id: "video", title: "Video", titles: { ar: VIDEO_MESSAGES.ar.title }, summary: "A silent test clip played by AVFoundation: play, pause, exact seek, rate, volume and mute with their status events, fullscreen and picture in picture.", summaries: { ar: "مقطع اختبار بلا صوت يشغّله AVFoundation: التشغيل والإيقاف المؤقت والانتقال الدقيق والسرعة والصوت والكتم مع أحداث حالتها، وملء الشاشة وصورة داخل صورة." }, component: Video },
  { id: "speech", title: "Speech", titles: { ar: SPEECH_MESSAGES.ar.title }, summary: "Text to speech with rate, pitch, volume and word-boundary events, pause, resume and stop; speech recognition with permissions, partial results, on-device recognition and cancel.", summaries: { ar: "تحويل النص إلى كلام مع السرعة وطبقة الصوت ومستوى الصوت وأحداث حدود الكلمات، والإيقاف المؤقت والمتابعة والإيقاف؛ والتعرف على الكلام مع الأذونات والنتائج الجزئية والتعرف على الجهاز والإلغاء." }, component: Speech },
  { id: "capture", title: "Capture", titles: { ar: CAPTURE_MESSAGES.ar.title }, summary: "Microphone recording with levels, the camera with a live preview and photos, and screen capture: displays and windows, screenshots and screen recording. Never prompts; simulated devices in test runs.", summaries: { ar: "تسجيل الميكروفون مع مستويات الصوت، والكاميرا مع معاينة حية والتقاط الصور، والتقاط الشاشة: الشاشات والنوافذ ولقطات الشاشة وتسجيل الشاشة. لا يطلب أي إذن بنفسه؛ والأجهزة محاكاة في تشغيلات الاختبار." }, component: Capture },
]);
