import { fileURLToPath } from "node:url";

/*
 * Bundled fonts (SIL OFL, licences beside them). The folder is two levels up from this file both in
 * `src/export` (tsx, vitest) and in `dist/export` (compiled), so the same relative path works in both.
 */
const FONT_DIR = fileURLToPath(new URL("../../assets/fonts/", import.meta.url));

export const FONT_FILES = {
  nameBold: "Poppins-Bold.ttf",
  headingItalic: "Poppins-SemiBoldItalic.ttf",
  body: "Figtree-Regular.ttf",
  bodyItalic: "Figtree-Italic.ttf",
  bodyBold: "Figtree-Bold.ttf",
} as const;

export type FontName = keyof typeof FONT_FILES;

export const fontPath = (name: FontName): string => FONT_DIR + FONT_FILES[name];
