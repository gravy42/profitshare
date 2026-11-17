// A colour from a project file, before it goes into a style. A hand-edited file can hold anything where a colour
// belongs, and `background: url(…)` would fetch whatever it names: only a plain colour gets through, and it is only
// ever set as `backgroundColor` or `color`, which cannot load anything.
const PLAIN = /^(#[0-9a-f]{3,8}|[a-z]{3,30}|(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch)\([0-9a-z.,%\s/+-]*\))$/i;
const NOT_COLOURS = /^(url|var|inherit|initial|unset|revert|image|element|attr|env|calc)$/i;

/** True for a hex, an rgb()/hsl()-style function of numbers, or a colour name: nothing that could name a file. */
export const isPlainColor = (v: unknown): v is string => typeof v === 'string' && PLAIN.test(v.trim()) && !NOT_COLOURS.test(v.trim());
/** The colour if it is a plain one, else the fallback. */
export const plainColor = (v: unknown, fallback = 'transparent'): string => (isPlainColor(v) ? v.trim() : fallback);
