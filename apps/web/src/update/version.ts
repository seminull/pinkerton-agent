// How the app notices that a newer version has been deployed.
//
// Every build names its JavaScript bundle after a hash of its contents
// (/assets/index-AbC123.js), and index.html is the one file that says which
// bundle is current. So "is there a newer version?" is: fetch index.html again
// and see whether it points at a different bundle than the one this tab is
// running. No version number to maintain, no build step, no server route — and
// it can't be wrong, because the name IS the contents.
//
// It only changes when the client changes. A deploy that touched nothing but
// the server leaves the bundle name alone, and correctly so: the tab is already
// running the current client.

/** The module script an index.html loads, or null if it has none. */
export const entryScriptOf = (html: string): string | null => {
  // The attributes can come in any order, so find each module script tag and
  // then read its src, rather than one regex that assumes a layout.
  for (const [tag] of html.matchAll(/<script\b[^>]*>/gi)) {
    if (!/\btype=["']module["']/i.test(tag)) continue;
    const src = /\bsrc=["']([^"']+)["']/i.exec(tag)?.[1];
    if (src) return src;
  }
  return null;
};

/** The bundle this tab is running. */
export const currentEntryScript = (): string | null =>
  document.querySelector('script[type="module"][src]')?.getAttribute("src") ?? null;

/**
 * Whether the server is now serving a different client than this tab runs.
 * False on any failure — during a deploy the server is briefly unreachable, and
 * "couldn't check" must never be reported as "there is an update".
 */
export const newVersionDeployed = async (): Promise<boolean> => {
  const running = currentEntryScript();
  if (!running) return false;
  try {
    // no-store: the whole point is to bypass whatever copy the browser holds.
    const response = await fetch("/index.html", { cache: "no-store" });
    if (!response.ok) return false;
    const latest = entryScriptOf(await response.text());
    return latest !== null && latest !== running;
  } catch {
    return false;
  }
};
