import type { ViewProps } from "react-native";

/**
 * React Native's own view props, forwarded to the backend view. `children` is omitted:
 * a WebView renders a document, not React children. The `satisfies` clause makes the
 * list fail to compile if it names something React Native does not accept.
 */
export const viewPropKeys = [
  "accessibilityActions", "accessibilityElementsHidden", "accessibilityHint", "accessibilityIgnoresInvertColors",
  "accessibilityLabel", "accessibilityLabelledBy", "accessibilityLanguage", "accessibilityLargeContentTitle",
  "accessibilityLiveRegion", "accessibilityRespondsToUserInteraction", "accessibilityRole",
  "accessibilityShowsLargeContentViewer", "accessibilityState", "accessibilityValue", "accessibilityViewIsModal",
  "accessible", "aria-busy", "aria-checked", "aria-disabled", "aria-expanded", "aria-hidden", "aria-label",
  "aria-labelledby", "aria-live", "aria-modal", "aria-selected", "aria-valuemax", "aria-valuemin", "aria-valuenow",
  "aria-valuetext", "collapsable", "collapsableChildren", "focusable", "hasTVPreferredFocus", "hitSlop", "id",
  "importantForAccessibility", "nativeID", "needsOffscreenAlphaCompositing",
  "onAccessibilityAction", "onAccessibilityEscape", "onAccessibilityTap", "onBlur", "onFocus", "onLayout",
  "onMagicTap", "onMoveShouldSetResponder", "onMoveShouldSetResponderCapture", "onPointerCancel",
  "onPointerCancelCapture", "onPointerDown", "onPointerDownCapture", "onPointerEnter", "onPointerEnterCapture",
  "onPointerLeave", "onPointerLeaveCapture", "onPointerMove", "onPointerMoveCapture", "onPointerUp",
  "onPointerUpCapture", "onResponderEnd", "onResponderGrant", "onResponderMove", "onResponderReject",
  "onResponderRelease", "onResponderStart", "onResponderTerminate", "onResponderTerminationRequest",
  "onStartShouldSetResponder", "onStartShouldSetResponderCapture", "onTouchCancel", "onTouchEnd",
  "onTouchEndCapture", "onTouchMove", "onTouchStart", "pointerEvents", "removeClippedSubviews",
  "renderToHardwareTextureAndroid", "role", "screenReaderFocusable", "shouldRasterizeIOS", "style", "tabIndex",
  "testID",
] as const satisfies readonly (keyof Omit<ViewProps, "children">)[];
export type ViewPropKey = (typeof viewPropKeys)[number];
