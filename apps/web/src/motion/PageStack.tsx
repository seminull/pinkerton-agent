import { Children, isValidElement, type ReactNode } from "react";
import type { Variants } from "motion/react";
// `m`, not `motion`: the slim component that only works inside the LazyMotion
// provider in main.tsx. See the note there for why.
import * as m from "motion/react-m";

// The page load-in. Every routed page uses this in place of its root <Stack>:
// its top-level sections (title row, filter card, table…) fade up into place
// one after another. One component, so every page moves the same way and the
// feel of the whole app can be retuned from the numbers below.
//
// Tuned to be noticed once and then ignored: a short rise, a quick stagger, the
// whole thing over in well under half a second. This is a tool people sit in
// all day — anything slower turns from polish into waiting.

const RISE_PX = 10;
const DURATION_S = 0.35;
const STAGGER_S = 0.06;
// A decelerating curve (fast out, soft landing). Elements arriving should look
// like they are settling, not like they are still accelerating as they stop.
const EASE_OUT = [0.22, 1, 0.36, 1] as const;

const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: STAGGER_S } },
};

const item: Variants = {
  hidden: { opacity: 0, y: RISE_PX },
  show: { opacity: 1, y: 0, transition: { duration: DURATION_S, ease: EASE_OUT } },
};

// Dialogs render into a portal, so wrapping one would add an empty animated
// <div> to the stack — invisible, but it still takes up a gap's worth of space
// at the bottom of the page. Anything with an `opened` prop (Mantine's Modal
// and this app's *FormModal components) is passed through untouched.
const isDialog = (child: ReactNode): boolean =>
  isValidElement(child) &&
  typeof child.props === "object" &&
  child.props !== null &&
  "opened" in child.props;

export default function PageStack({ children }: { children: ReactNode }) {
  return (
    // An m.div laid out exactly like Mantine's default <Stack> (a column
    // with the theme's md gap), rather than <Stack component={m.div}>:
    // Stack isn't typed as polymorphic, so it rejects Motion's props. The gap
    // comes from the theme variable, so it still tracks a spacing change.
    <m.div
      variants={container}
      initial="hidden"
      animate="show"
      style={{ display: "flex", flexDirection: "column", gap: "var(--mantine-spacing-md)" }}
    >
      {Children.map(children, (child) =>
        // null/false from a `cond && <X />` renders nothing; don't wrap it.
        child === null || child === undefined || typeof child === "boolean" || isDialog(child) ? (
          child
        ) : (
          // Sections that mount later — the table that replaces the loading
          // spinner, an error alert — get the same entrance, because they
          // start from `hidden` under a parent that is already at `show`.
          <m.div variants={item}>{child}</m.div>
        )
      )}
    </m.div>
  );
}
