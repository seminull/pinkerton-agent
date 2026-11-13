import { Image, type StyleProp } from "@mantine/core";
import logoDark from "./logo-dark.svg";
import logoLight from "./logo-light.svg";
import markDark from "./pinkerton-agent-square-icon-dark.svg";
import markLight from "./pinkerton-agent-square-icon-light.svg";

// The brand artwork:
//
//   logo-*.svg         the doorway lockup — arch, key, and "Pinkerton Agent
//                      Real Estate" lettering. For places with room: the
//                      login screen.
//   pinkerton-agent-square-icon-*.svg
//                      the key in a square frame, no lettering. For the app
//                      header, where lettering would be an unreadable smudge
//                      at 34px and the name is set in text right beside it.
//   pinkerton-agent-key-*.svg
//                      the key alone, as supplied. The source for
//                      public/favicon.svg (the browser tab icon): a frame
//                      would eat most of a 16px tab icon, so the key goes
//                      bare. The favicon is one file carrying both
//                      colourings behind a prefers-color-scheme query,
//                      because a <link rel="icon"> can't be swapped by
//                      Mantine's CSS — if the key artwork changes, copy the
//                      path into it again.
//   logo-circle-*.svg, mark-circle-*.svg
//                      the earlier circular lockup and its header crop.
//                      Superseded by the square icon; not rendered.
//
// Each comes in a light-background and a dark-background colouring.

interface Props {
  /**
   * Rendered height in px; width follows the artwork's aspect ratio. Takes
   * Mantine's responsive form too — `{ base: 150, xs: 190 }` — so a caller can
   * shrink the artwork on a phone.
   */
  h: StyleProp<number>;
}

// Both colourings are rendered and CSS hides the wrong one (Mantine's
// lightHidden / darkHidden). Choosing in JavaScript instead would mean reading
// the colour scheme in an effect, and the first paint would flash the wrong
// logo. The hidden image is display:none, so screen readers get one, not two.
const Themed = ({ light, dark, alt, h }: Props & { light: string; dark: string; alt: string }) => (
  <>
    <Image src={light} alt={alt} h={h} w="auto" fit="contain" darkHidden />
    <Image src={dark} alt={alt} h={h} w="auto" fit="contain" lightHidden />
  </>
);

export const BrandLogo = ({ h }: Props) => (
  <Themed light={logoLight} dark={logoDark} alt="Pinkerton Agent Real Estate" h={h} />
);

// Empty alt on purpose: wherever the mark appears it sits beside the name in
// text, and announcing "Pinkerton Agent" twice helps nobody.
export const BrandMark = ({ h }: Props) => (
  <Themed light={markLight} dark={markDark} alt="" h={h} />
);
