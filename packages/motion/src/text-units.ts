// How MotionText splits text into the units it animates (docs/motion.md#text-transitions): one per character, as a
// reader sees it, except in scripts whose letters join or combine, which animate a word at a time to keep their shapes.

/** Combining marks, variation selectors, skin-tone modifiers and tag characters: they belong to the character before. */
const MARK = "\\u0300-\\u036F\\u0483-\\u0489\\u1AB0-\\u1AFF\\u1DC0-\\u1DFF\\u20D0-\\u20FF\\uFE00-\\uFE0F\\uFE20-\\uFE2F\\u{1F3FB}-\\u{1F3FF}\\u{E0020}-\\u{E007F}";
/** A character as a reader sees it: a flag (two regional indicators), or a base with its marks and zero-width-joined parts. */
const CHARACTER = new RegExp(`[\\u{1F1E6}-\\u{1F1FF}]{2}|[^${MARK}][${MARK}]*(?:\\u200D[^${MARK}][${MARK}]*)*|[${MARK}]+`, "gu");
/** Scripts whose letters join (Arabic, Syriac, N'Ko, Mongolian) or form conjuncts and stacks (Indic, Southeast Asian, Tibetan). */
const JOINED = /[؀-ࣿऀ-෿฀-࿿က-႟ក-᢯ꡀ-ꣿﭐ-﷿ﹰ-﻿]/;

/** The units of `text`: characters, whole words of joined scripts, runs of spaces, and `\n` for each line break. */
export function textUnits(text: string): string[] {
  return text.split(/(\n|[^\S\n]+)/).flatMap(part => !part ? [] : /\s/.test(part) || JOINED.test(part) ? [part] : part.match(CHARACTER) ?? []);
}

/** How many leading units `next` shares with `previous`. */
export function sharedUnits(previous: readonly string[], next: readonly string[]): number {
  let count = 0;
  while (count < previous.length && count < next.length && previous[count] === next[count]) count++;
  return count;
}
