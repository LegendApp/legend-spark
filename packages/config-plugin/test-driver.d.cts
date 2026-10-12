/** The Podfile with an opt-in line for each test driver option `macos` sets, and without the others. */
export declare function testDriverPodfile(contents: string, macos: { testDriverInRelease?: boolean; testDriverPrivateEvents?: boolean } | undefined): string;
