import {
  ActionIcon,
  Affix,
  Tooltip,
  useComputedColorScheme,
  useMantineColorScheme,
} from "@mantine/core";
import { IconMoon, IconSun } from "@tabler/icons-react";

interface Props {
  /**
   * Pin the button to the top-right corner of the window instead of rendering
   * it in place. For screens with no header to put it in — the login page.
   */
  affixed?: boolean;
}

// Flips between light and dark. Until it is first pressed the app follows the
// operating system's setting (defaultColorScheme="auto" in main.tsx); after
// that the choice is remembered in this browser by Mantine (localStorage), and
// applied before first paint by the inline script in index.html.
//
// A two-state toggle, not light/dark/auto: the button shows the scheme you'd
// switch TO, and a third "follow the system" state has no icon anyone reads
// correctly at this size.
export default function ColorSchemeToggle({ affixed = false }: Props) {
  // "Computed" resolves auto to whichever scheme is actually showing, which is
  // what the icon has to reflect.
  const dark = useComputedColorScheme("light") === "dark";
  const { setColorScheme } = useMantineColorScheme();
  const label = `Switch to ${dark ? "light" : "dark"} mode`;

  const toggle = (
    <Tooltip label={label} position={affixed ? "left" : "bottom"}>
      <ActionIcon
        aria-label={label}
        onClick={() => setColorScheme(dark ? "light" : "dark")}
        radius="xl"
        size="lg"
        variant="default"
      >
        {dark ? <IconSun size={18} /> : <IconMoon size={18} />}
      </ActionIcon>
    </Tooltip>
  );

  return affixed ? <Affix position={{ top: 16, right: 16 }}>{toggle}</Affix> : toggle;
}
