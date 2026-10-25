/** The Podfile with the release opt-in line when `macos` sets testDriverInRelease, and without it otherwise. */
export declare function testDriverPodfile(contents: string, macos: { testDriverInRelease?: boolean } | undefined): string;
