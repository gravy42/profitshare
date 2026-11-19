// Addresses out of a project file, before the page uses them. A project is a .json anyone may have been sent, and a
// hand-edited one can hold anything where a link or a picture belongs: `javascript:` in a link runs in this page, and
// a picture at a web address is fetched the moment it is drawn, which tells that address somebody opened the file.
// Two rules, each in one place: a link goes only to the web, and a picture is only one carried inside the file.

/** The address as the browser reads it when it is a web address (http: or https:, spaces around it allowed);
 *  null for anything else: another scheme, an address with no scheme, an empty value, a value that is not text. */
export function webLink(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  let url: URL;
  try {
    url = new URL(v.trim());
  } catch {
    return null;
  } // no base given: a relative or //host address does not parse
  return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
}

/** True for a picture embedded in the file (a `data:image/…` address), which the browser draws without asking anyone. */
export const isEmbeddedImage = (v: unknown): v is string => typeof v === 'string' && v.startsWith('data:image/');
