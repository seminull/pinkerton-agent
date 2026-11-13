import { Image, type StyleProp } from "@mantine/core";
import logoDark from "./logo-dark.svg";
import logoLight from "./logo-light.svg";
import markDark from "./mark-dark.svg";
import markLight from "./mark-light.svg";

// The brand artwork, in two cuts:
//
//   logo-*.svg  the full lockup — doorway, key, and "Pinkerton Agent Real
//               Estate" lettering. For places with room: the login screen.
//   mark-*.svg  the doorway and key alone, cropped square from the same
//               artwork. For small sizes, where the lettering would be an
//               unreadable smudge: the app header. (public/favicon.svg is the
//               same crop for the browser tab.)
//
// Each comes in a light-background and a dark-background colouring. The mark
// files are derived from the logo files — if the artwork changes, re-cut them
// rather than editing the two independently.

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
