// Google Fonts on the Pitch tab: the button beside each font field under Design system, and the row that says what a
// role's picked font is. Light on purpose: the picker itself (and the catalogue it lists) is fetched when the button
// is pressed, and nothing is asked of Google until the person has said yes inside it.
import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import type { FontFile, PitchDesign } from '../engine/types';
import { fileSize } from '../engine/deckEdit';
import { fontSrcOk, weightText } from '../deck-runtime/fonts';
import { GOOGLE_WARN_BYTES, LICENCE_NAMES, pickedFontName, removeRoleFonts, roleFont, setRoleFonts, type CatalogueFamily, type FontLicence, type FontRole, type RoleFont } from '../engine/googleFonts';
import { Boundary } from './Boundary';
import './googleFonts.css';

const Dialog = lazy(() => import('./GoogleFontsDialog'));
type SetDesign = (f: (x: PitchDesign) => PitchDesign) => void;
const isLicence = (l: string): l is FontLicence => l in LICENCE_NAMES;

/** The design with a role's font taken out: its files, and its name from the font field if the field still holds it. */
export function withoutRoleFont(d: PitchDesign, role: FontRole): PitchDesign {
  const had = roleFont(d.fontFiles, role);
  const rest = removeRoleFonts(d.fontFiles, role);
  const { fontFiles: _f, ...other } = d;
  const next: PitchDesign = rest.length ? { ...other, fontFiles: rest } : other;
  const typed = typeof d.fonts?.[role] === 'string' ? d.fonts[role] : '';
  return had?.google && typed.trim() === had.family ? { ...next, fonts: { ...next.fonts, [role]: '' } } : next;
}
/** The design with a family picked from Google Fonts as a role's font: its files in the project, its name in the font field. */
export function withGoogleFont(d: PitchDesign, role: FontRole, family: CatalogueFamily, files: FontFile[]): PitchDesign {
  return { ...d, fonts: { title: typeof d.fonts?.title === 'string' ? d.fonts.title : '', body: typeof d.fonts?.body === 'string' ? d.fonts.body : '', [role]: pickedFontName(family) }, fontFiles: setRoleFonts(d.fontFiles, role, files) };
}

/** The app's own pages draw a font field's value by name (the slide corner beside the design system). A picked family
 *  is in the project and not on the computer, so it is given to the page under its own name while it is in use. */
function useFontOnThisPage(font: RoleFont | undefined): void {
  const key = font?.google ? font.files.map(f => f.id).join('|') : '';
  useEffect(() => {
    if (!font?.google || typeof FontFace === 'undefined' || !document.fonts?.add) return;
    const faces: FontFace[] = [];
    for (const f of font.files) {
      if (!fontSrcOk(f.dataUrl)) continue;
      try { const face = new FontFace(font.family, `url("${f.dataUrl}")`, { weight: f.weight !== undefined ? weightText(f.weight) : '400', style: f.style ?? 'normal' }); document.fonts.add(face); void face.load().catch(() => undefined); faces.push(face); }
      catch { /* a file the browser will not take: the field's next font is drawn */ }
    }
    return () => { for (const face of faces) document.fonts.delete(face); };
  }, [key]);   // eslint-disable-line react-hooks/exhaustive-deps
}

/** "Pick from Google Fonts", for one role. Opens the picker; a font picked there becomes the role's font. */
export function GoogleFontPick({ role, design, set, film }: { role: FontRole; design: PitchDesign; set: SetDesign; film: string }) {
  const [open, setOpen] = useState(false);
  const [said, setSaid] = useState<{ text: string; warn: boolean } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const font = roleFont(design.fontFiles, role);
  useFontOnThisPage(font);
  const close = () => { setOpen(false); window.setTimeout(() => button.current?.focus(), 0); };
  const pick = (family: CatalogueFamily, files: FontFile[]) => {
    set(d => withGoogleFont(d, role, family, files));
    const bytes = roleFont(files, role)?.bytes ?? 0;
    setSaid({ text: `${family.family} is now the ${role} font, and ${fileSize(bytes)} of font files are saved in your project${bytes > GOOGLE_WARN_BYTES ? '. That is a lot for a font: every deck you send will be that much bigger.' : ', so the deck never needs Google.'}`, warn: bytes > GOOGLE_WARN_BYTES });
    close();
  };
  return (
    <div className="gf-pick">
      <button type="button" ref={button} className="btn small" aria-haspopup="dialog" aria-label={`Pick the ${role} font from Google Fonts`} onClick={() => { setSaid(null); setOpen(true); }}>Pick from Google Fonts</button>
      <div role="status" aria-live="polite">{said && <p className={`small ${said.warn ? 'pd-bad' : 'gf-said'}`}>{said.warn ? '' : '✓ '}{said.text}</p>}</div>
      {open && <Boundary what="The font picker"><Suspense fallback={null}><Dialog role={role} film={film} current={font?.google ? font.family : undefined} onPick={pick} onClose={close} /></Suspense></Boundary>}
    </div>
  );
}

/** What a role's picked font is, under Font files: the family, its weights, its size, its licence. */
export function GoogleFontDetail({ font }: { font: RoleFont }) {
  const licence = isLicence(font.licence) ? `Open licence (${font.licence}): can go inside a deck you send.` : 'Open licence: can go inside a deck you send.';
  return (
    <div className="fontrow-detail gf-detail">
      <p><b>{font.family}</b> <span className="small">from Google Fonts · {font.weights || 'one weight'} · {font.missing ? 'missing from this browser: pick it again' : fileSize(font.bytes)}</span></p>
      <p className="hint">{licence} It is saved in your project file, so the deck never asks Google for it.</p>
      {font.bytes > GOOGLE_WARN_BYTES && <p className="pd-bad small">These font files are {fileSize(font.bytes)} together. A deck that carries them will be slower to send and to open.</p>}
    </div>
  );
}
