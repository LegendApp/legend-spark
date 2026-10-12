import { TurboModuleRegistry, type TurboModule } from "react-native";

// The test-only NativeSDKTestDriver (fixtures/sdk-test-driver), linked only into the custom builds that the
// window-showing scripts/test-*.ts harnesses make. Other builds, including driver mode (docs/test-driver.md),
// have none, and the checks that need it do not run.
export type SDKTestDriver = TurboModule & { call(method: string, args: string): Promise<string> };
export const sdkTestDriver = TurboModuleRegistry.get<SDKTestDriver>("NativeSDKTestDriver");
