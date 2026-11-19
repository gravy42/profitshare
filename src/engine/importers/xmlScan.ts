/** A small forward-only XML scanner for the parts of an .xlsx we read. Engine code has no DOM, and these files come
 *  from strangers, so this is written to be boring: it walks the text once by index (indexOf / charCodeAt), never
 *  backtracks, uses no regular expressions, never recurses, expands no entities beyond the five XML ones and
 *  numeric character references, and refuses a document that declares its own (<!DOCTYPE …>). */

class XmlError extends Error {}

interface XmlHandler {
  /** An opening tag. `name` has any namespace prefix removed. Attributes live in xml[from, to).
   *  `selfClosing` is true for <tag/>, in which case `close` follows at once. */
  open(name: string, from: number, to: number, selfClosing: boolean): void;
  /** A closing tag (also called right after `open` for a self-closing <tag/>). */
  close(name: string): void;
  /** Text between tags, as xml[from, to). `raw` is true inside <![CDATA[ … ]]>, where nothing is escaped. */
  text(from: number, to: number, raw: boolean): void;
}

const localName = (qname: string) => {
  const i = qname.indexOf(':');
  return i < 0 ? qname : qname.slice(i + 1);
};
const isSpace = (c: number) => c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;

export function scanXml(xml: string, h: XmlHandler): void {
  const n = xml.length;
  let i = 0;
  while (i < n) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) {
      h.text(i, n, false);
      break;
    }
    if (lt > i) h.text(i, lt, false);
    const c = xml.charCodeAt(lt + 1);
    if (c === 0x21) {
      // <!
      if (xml.startsWith('<!--', lt)) {
        const e = xml.indexOf('-->', lt + 4);
        if (e < 0) throw new XmlError('unterminated comment');
        i = e + 3;
      } else if (xml.startsWith('<![CDATA[', lt)) {
        const e = xml.indexOf(']]>', lt + 9);
        if (e < 0) throw new XmlError('unterminated CDATA');
        h.text(lt + 9, e, true);
        i = e + 3;
      } else throw new XmlError('document type declarations are not accepted');
    } else if (c === 0x3f) {
      // <? … ?>
      const e = xml.indexOf('?>', lt + 2);
      if (e < 0) throw new XmlError('unterminated processing instruction');
      i = e + 2;
    } else if (c === 0x2f) {
      // </name>
      const e = xml.indexOf('>', lt + 2);
      if (e < 0) throw new XmlError('unterminated closing tag');
      let q = e;
      while (q > lt + 2 && isSpace(xml.charCodeAt(q - 1))) q--;
      h.close(localName(xml.slice(lt + 2, q)));
      i = e + 1;
    } else {
      // <name attr="…" …> or <name …/>
      let p = lt + 1;
      while (p < n) {
        const d = xml.charCodeAt(p);
        if (isSpace(d) || d === 0x3e || d === 0x2f) break;
        p++;
      }
      if (p === lt + 1) throw new XmlError('stray <');
      const name = localName(xml.slice(lt + 1, p));
      const attrsFrom = p;
      for (;;) {
        if (p >= n) throw new XmlError('unterminated tag');
        const d = xml.charCodeAt(p);
        if (d === 0x3e) break;
        if (d === 0x22 || d === 0x27) {
          const e = xml.indexOf(d === 0x22 ? '"' : "'", p + 1);
          if (e < 0) throw new XmlError('unterminated attribute');
          p = e + 1;
        } else p++;
      }
      const selfClosing = xml.charCodeAt(p - 1) === 0x2f && p - 1 >= attrsFrom;
      h.open(name, attrsFrom, selfClosing ? p - 1 : p, selfClosing);
      if (selfClosing) h.close(name);
      i = p + 1;
    }
  }
}

/** The value of one attribute of a tag whose attributes are xml[from, to), or undefined. With `anyPrefix`, `want` is
 *  matched against the part of the attribute's name after its namespace prefix, and only prefixed attributes count
 *  (so want = "id" finds r:id but not id). Returns the value still escaped; pass it through decodeXml. */
export function rawAttr(xml: string, from: number, to: number, want: string, anyPrefix = false): string | undefined {
  let p = from;
  while (p < to) {
    while (p < to && isSpace(xml.charCodeAt(p))) p++;
    const ns = p;
    while (p < to) {
      const d = xml.charCodeAt(p);
      if (d === 0x3d || isSpace(d)) break;
      p++;
    }
    const ne = p;
    while (p < to && isSpace(xml.charCodeAt(p))) p++;
    if (p >= to || xml.charCodeAt(p) !== 0x3d) return undefined;
    p++;
    while (p < to && isSpace(xml.charCodeAt(p))) p++;
    const q = xml.charCodeAt(p);
    if (q !== 0x22 && q !== 0x27) return undefined;
    const e = xml.indexOf(q === 0x22 ? '"' : "'", p + 1);
    if (e < 0 || e >= to) return undefined;
    let match: boolean;
    if (anyPrefix) {
      const colon = xml.slice(ns, ne).indexOf(':');
      match = colon > 0 && ne - ns - colon - 1 === want.length && xml.startsWith(want, ns + colon + 1);
    } else match = ne - ns === want.length && xml.startsWith(want, ns);
    if (match) return xml.slice(p + 1, e);
    p = e + 1;
  }
  return undefined;
}

const isHex = (c: number) => (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66);

/** Turn escaped XML text into the text it stands for: &amp; &lt; &gt; &quot; &apos;, &#65; and &#x41;, and Excel's
 *  own _x000D_ form for characters XML cannot carry. Anything it does not recognise is left exactly as written. */
export function decodeXml(s: string): string {
  let amp = s.indexOf('&'),
    esc = s.indexOf('_x');
  if (amp < 0 && esc < 0) return s;
  const out: string[] = [];
  let last = 0;
  const n = s.length;
  for (;;) {
    let i: number;
    if (amp >= 0 && (esc < 0 || amp < esc)) i = amp;
    else if (esc >= 0) i = esc;
    else break;
    let rep: string | null = null,
      len = 0;
    if (i === amp) {
      let semi = -1; // look a few characters ahead only: never rescan the tail
      for (let k = i + 2; k <= i + 10 && k < n; k++)
        if (s.charCodeAt(k) === 0x3b) {
          semi = k;
          break;
        }
      if (semi > 0) {
        const body = s.slice(i + 1, semi);
        if (body === 'amp') rep = '&';
        else if (body === 'lt') rep = '<';
        else if (body === 'gt') rep = '>';
        else if (body === 'quot') rep = '"';
        else if (body === 'apos') rep = "'";
        else if (body.charCodeAt(0) === 0x23 && body.length > 1) {
          const hex = body.charCodeAt(1) === 0x78 || body.charCodeAt(1) === 0x58;
          let code = 0,
            ok = body.length > (hex ? 2 : 1);
          for (let k = hex ? 2 : 1; k < body.length && ok; k++) {
            const d = body.charCodeAt(k);
            if (hex ? isHex(d) : d >= 0x30 && d <= 0x39)
              code = code * (hex ? 16 : 10) + (d <= 0x39 ? d - 0x30 : (d | 0x20) - 0x57);
            else ok = false;
          }
          if (ok && code <= 0x10ffff) rep = String.fromCodePoint(code);
        }
        if (rep !== null) len = semi - i + 1;
      }
    } else if (
      i + 6 < n &&
      s.charCodeAt(i + 6) === 0x5f &&
      isHex(s.charCodeAt(i + 2)) &&
      isHex(s.charCodeAt(i + 3)) &&
      isHex(s.charCodeAt(i + 4)) &&
      isHex(s.charCodeAt(i + 5))
    ) {
      rep = String.fromCharCode(parseInt(s.slice(i + 2, i + 6), 16));
      len = 7;
    }
    if (rep !== null) {
      out.push(s.slice(last, i), rep);
      last = i + len;
    }
    const next = rep !== null ? i + len : i + 1;
    if (amp >= 0 && amp < next) amp = s.indexOf('&', next);
    if (esc >= 0 && esc < next) esc = s.indexOf('_x', next);
  }
  if (last === 0) return s;
  out.push(s.slice(last));
  return out.join('');
}
