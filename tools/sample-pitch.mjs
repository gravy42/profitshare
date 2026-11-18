// The sample film's pitch: its look book (drawn here, by arithmetic), a design system worked out from those pictures
// by the app's own palette engine, and a whole pitch deck. Everything is invented: the film, the people, the studies,
// the numbers. Nothing is read from disk or the network and nothing depends on the clock or on chance, so the same
// script always writes the same file. Called by tools/make-sample.mjs.

// ---------- pictures: abstract desert and night landscapes, as SVG ----------

const W = 1600, H = 900;
/** A small seeded generator (mulberry32): the same seed always gives the same hills. */
const seeded = seed => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const lerp = (a, b, t) => a + (b - a) * t;
const mixRgb = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));

/** A ridge line: heights at 33 points across the picture, rolling around `y` by up to `amp`. */
function ridge(rand, y, amp) {
  const pts = []; let v = 0;
  for (let i = 0; i <= 32; i++) { v = v * 0.72 + (rand() - 0.5) * 0.9; pts.push(Math.round(y + v * amp)); }
  return pts;
}
const ridgeAt = (pts, x) => { const f = Math.max(0, Math.min(32, (x / W) * 32)); const i = Math.min(31, Math.floor(f)); return lerp(pts[i], pts[i + 1], f - i); };

/** One picture, described once and drawn twice: as SVG (what the look book holds) and as a grid of pixels (what the
 *  palette engine reads). Layers back to front: sky, stars, disc, ridges, ground, then a few flat shapes. */
function scene(spec) {
  const rand = seeded(spec.seed);
  const ridges = spec.ridges.map(r => ({ ...r, pts: ridge(rand, r.y, r.amp) }));
  const stars = Array.from({ length: spec.stars ?? 0 }, () => ({ x: Math.round(rand() * W), y: Math.round(rand() * spec.horizon * 0.85), r: 1 + Math.round(rand() * 2) }));
  const sky = spec.sky.map(rgb);
  const skyAt = y => { const t = Math.max(0, Math.min(1, y / spec.horizon)) * (sky.length - 1); const i = Math.min(sky.length - 2, Math.floor(t)); return mixRgb(sky[i], sky[i + 1], t - i); };
  const inShape = (s, x, y) => (s.kind === 'rect' ? x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h
    : s.kind === 'road' ? y >= spec.horizon && Math.abs(x - s.x) <= lerp(s.far, s.near, (y - spec.horizon) / (H - spec.horizon)) / 2
      : s.kind === 'band' ? y >= s.y && y <= s.y + s.h : false);
  const colourAt = (x, y) => {
    let c = y < spec.horizon ? skyAt(y) : rgb(spec.ground);
    if (spec.disc && y < spec.horizon + spec.disc.r) {
      const d = Math.hypot(x - spec.disc.x, y - spec.disc.y);
      if (d <= spec.disc.r) c = rgb(spec.disc.fill); else if (d <= spec.disc.r * 2.6 && y < spec.horizon) c = mixRgb(c, rgb(spec.disc.fill), 0.28 * (1 - (d - spec.disc.r) / (spec.disc.r * 1.6)));
    }
    for (const r of ridges) if (y >= ridgeAt(r.pts, x) && y < spec.horizon) c = rgb(r.fill);
    if (y >= spec.horizon) c = rgb(spec.ground);
    for (const s of spec.shapes ?? []) if (inShape(s, x, y)) c = rgb(s.fill);
    return c;
  };
  const pixels = [];
  for (let j = 0; j < 36; j++) for (let i = 0; i < 64; i++) pixels.push(colourAt((i + 0.5) * (W / 64), (j + 0.5) * (H / 36)).map(Math.round));

  const id = spec.id;
  const stops = spec.sky.map((c, i) => `<stop offset="${Math.round((i / (spec.sky.length - 1)) * 100)}%" stop-color="${c}"/>`).join('');
  const parts = [
    `<defs><linearGradient id="${id}-sky" x1="0" y1="0" x2="0" y2="1">${stops}</linearGradient>${spec.disc ? `<radialGradient id="${id}-glow"><stop offset="38%" stop-color="${spec.disc.fill}" stop-opacity=".3"/><stop offset="100%" stop-color="${spec.disc.fill}" stop-opacity="0"/></radialGradient>` : ''}</defs>`,
    `<rect width="${W}" height="${spec.horizon}" fill="url(#${id}-sky)"/>`,
    ...stars.map(s => `<circle cx="${s.x}" cy="${s.y}" r="${s.r}" fill="#f4eddc" opacity=".8"/>`),
    spec.disc ? `<circle cx="${spec.disc.x}" cy="${spec.disc.y}" r="${Math.round(spec.disc.r * 2.6)}" fill="url(#${id}-glow)"/><circle cx="${spec.disc.x}" cy="${spec.disc.y}" r="${spec.disc.r}" fill="${spec.disc.fill}"/>` : '',
    ...ridges.map(r => `<path d="M0 ${spec.horizon} ${r.pts.map((y, i) => `L${i * 50} ${y}`).join(' ')} L${W} ${spec.horizon}Z" fill="${r.fill}"/>`),
    `<rect y="${spec.horizon}" width="${W}" height="${H - spec.horizon}" fill="${spec.ground}"/>`,
    ...(spec.shapes ?? []).map(s => (s.kind === 'rect' ? `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" fill="${s.fill}"/>`
      : s.kind === 'band' ? `<rect y="${s.y}" width="${W}" height="${s.h}" fill="${s.fill}"/>`
        : `<path d="M${s.x - s.far / 2} ${spec.horizon} L${s.x + s.far / 2} ${spec.horizon} L${s.x + s.near / 2} ${H} L${s.x - s.near / 2} ${H}Z" fill="${s.fill}"/>`)),
  ];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join('')}</svg>`;
  return { id, caption: spec.caption, section: spec.section, svg, pixels };
}

const SCENES = [
  { id: 'look_dawn', caption: 'Dawn on the highway shoulder (drawn for the sample)', section: 'tone', seed: 11, horizon: 610,
    sky: ['#1c2242', '#6a4468', '#d9795a', '#f4bd7c'], disc: { x: 1180, y: 590, r: 46, fill: '#ffe2a8' },
    ridges: [{ y: 520, amp: 70, fill: '#4a3358' }, { y: 575, amp: 40, fill: '#2c2140' }], ground: '#1a1626',
    shapes: [{ kind: 'road', x: 520, far: 26, near: 620, fill: '#2b2535' }, { kind: 'road', x: 520, far: 2, near: 22, fill: '#e8c98a' }] },
  { id: 'look_flats', caption: 'The flats at noon: white to the horizon (drawn for the sample)', section: 'world', seed: 23, horizon: 520,
    sky: ['#5f93bd', '#a9c8dc', '#e6eef0'], disc: { x: 300, y: 150, r: 38, fill: '#fffaf0' },
    ridges: [{ y: 492, amp: 26, fill: '#8ea8bf' }, { y: 510, amp: 12, fill: '#a9b9c6' }], ground: '#efe8d8',
    shapes: [{ kind: 'band', y: 600, h: 3, fill: '#ded5c1' }, { kind: 'band', y: 700, h: 4, fill: '#ded5c1' }, { kind: 'band', y: 820, h: 6, fill: '#d8cdb5' }, { kind: 'rect', x: 1090, y: 470, w: 30, h: 58, fill: '#4a4338' }, { kind: 'rect', x: 1082, y: 524, w: 46, h: 8, fill: '#3a342c' }] },
  { id: 'look_motel', caption: 'The motel at night: one lit window, the empty pool (drawn for the sample)', section: 'world', seed: 37, horizon: 600, stars: 70,
    sky: ['#070b1c', '#101a3a', '#22315c'], disc: { x: 1320, y: 170, r: 34, fill: '#e9edf5' },
    ridges: [{ y: 560, amp: 34, fill: '#0b1126' }], ground: '#0c0f1a',
    shapes: [{ kind: 'rect', x: 180, y: 500, w: 640, h: 120, fill: '#161b2e' }, { kind: 'rect', x: 180, y: 488, w: 640, h: 14, fill: '#23294a' }, { kind: 'rect', x: 600, y: 536, w: 70, h: 52, fill: '#f2b24a' }, { kind: 'rect', x: 250, y: 536, w: 70, h: 52, fill: '#1e2540' }, { kind: 'rect', x: 425, y: 536, w: 70, h: 52, fill: '#1e2540' }, { kind: 'rect', x: 940, y: 700, w: 470, h: 90, fill: '#1f5a66' }, { kind: 'rect', x: 940, y: 700, w: 470, h: 10, fill: '#3d8791' }] },
  { id: 'look_dusk', caption: 'Dusk: the wagon, small against the sky (drawn for the sample)', section: 'tone', seed: 53, horizon: 640,
    sky: ['#231a45', '#7a3f6b', '#de6f4a', '#f7c765'], disc: { x: 420, y: 632, r: 60, fill: '#ffd98a' },
    ridges: [{ y: 560, amp: 60, fill: '#5a2f52' }, { y: 612, amp: 30, fill: '#2f1c3a' }], ground: '#1b1322',
    shapes: [{ kind: 'road', x: 1050, far: 30, near: 700, fill: '#2a1f30' }, { kind: 'rect', x: 1026, y: 618, w: 48, h: 18, fill: '#120d18' }, { kind: 'rect', x: 1036, y: 608, w: 26, h: 12, fill: '#120d18' }] },
  { id: 'look_night', caption: 'Night drive on the ranger road (drawn for the sample)', section: 'tone', seed: 71, horizon: 660, stars: 110,
    sky: ['#050816', '#0d1736', '#1c2c5a', '#34437a'], disc: { x: 260, y: 210, r: 54, fill: '#f1ecdc' },
    ridges: [{ y: 590, amp: 80, fill: '#141d40' }, { y: 635, amp: 36, fill: '#0a0f24' }], ground: '#080b18',
    shapes: [{ kind: 'road', x: 900, far: 20, near: 520, fill: '#111630' }, { kind: 'rect', x: 884, y: 664, w: 12, h: 6, fill: '#f2b24a' }, { kind: 'rect', x: 904, y: 664, w: 12, h: 6, fill: '#f2b24a' }] },
];
// the film's mark: a low sun on the horizon, on nothing (it sits on whatever is behind it)
const MARK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="300" viewBox="0 0 480 300"><path d="M150 214a90 90 0 0 1 180 0Z" fill="#f2b24a"/><rect x="40" y="214" width="400" height="14" rx="7" fill="#f4eddc"/><rect x="110" y="246" width="260" height="10" rx="5" fill="#f4eddc" opacity=".7"/><rect x="180" y="274" width="120" height="8" rx="4" fill="#f4eddc" opacity=".45"/></svg>';

const dataUrl = svg => `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;

// ---------- the pitch ----------

const SURVEY = 'Invented Audience Survey, 2030', LISTENERS = 'Invented Listener Study, 2030', BOX = 'Invented Box Office Review, 2029', BUYERS = 'Invented Buyers Poll, 2030';

/** `engine` is the app's own palette code (src/engine/palette.ts), so the sample's colours are what the app would propose. */
export function buildSamplePitch(engine) {
  const drawn = SCENES.map(scene);
  const lookbook = [
    ...drawn.map(d => ({ id: d.id, dataUrl: dataUrl(d.svg), caption: d.caption, section: d.section })),
    { id: 'look_mark', dataUrl: dataUrl(MARK_SVG), caption: 'The film\'s mark: a low sun on the horizon (drawn for the sample)', section: 'reference' },
  ];
  const night = engine.proposeThemes(engine.quantize(drawn.flatMap(d => d.pixels), 8)).find(p => p.id === 'night');
  const failed = engine.checkTheme(night.colors).filter(c => !c.pass);
  if (failed.length) throw new Error(`the sample's palette fails its own checks: ${failed.map(f => f.label).join(', ')}`);
  const pair = engine.TYPE_PAIRINGS[0];
  const { card, ...colors } = night.colors;
  const design = {
    name: 'Salt Flat', colors, card, fonts: { title: pair.title, body: pair.body }, hand: true,
    notes: 'Worked out from the look book: a night ground, a sand card, one warm accent and the cool blue of the flats at noon. Typewriter titles, plain text, handwriting on the papers.',
    deck: { layout: 'split', eyebrow: false, bleed: 0.55, lookSlides: 3, coverImageId: 'look_dawn', closingImageId: 'look_dusk', signoff: 'Thank you for reading' },
  };

  const logline = 'Two estranged sisters push a dead station wagon across the desert to deliver their mother\'s last letter.';
  const story = 'Lena wants the letter burned. June wants it read. Their mother asked for it to be left under a stone on the salt flats, and the only way there is together.\n\nBy the time they reach the stone, the car is the least broken thing they have fixed.';
  const why = 'I spent my summers in a motel my aunt ran at the edge of a dry lake. Nobody stayed more than a night, and everybody told her more than they meant to.\n\nSalt Flat is that place and those people: one road, one motel, two sisters who have run out of ways to avoid each other. I wrote it for what a small crew can shoot well in twelve days.';

  const comps = [
    { id: 'comp_alkali', title: 'Alkali Sisters (invented)', year: '2027', distributor: '', budget: 600_000, domestic: 1_900_000, worldwide: 3_100_000, note: 'Festival premiere, then a small theatrical run.', source: '', group: 'Festival first' },
    { id: 'comp_shoulder', title: 'The Long Shoulder (invented)', year: '2028', distributor: '', budget: 900_000, domestic: 1_500_000, worldwide: 2_600_000, note: 'Festival premiere, sold for streaming.', source: '', group: 'Festival first' },
    { id: 'comp_mile', title: 'Mile Marker 40 (invented)', year: '2029', distributor: '', budget: 1_400_000, domestic: 2_000_000, worldwide: 3_200_000, note: 'Sold to a streamer before its premiere.', source: '', group: 'Streaming first' },
    { id: 'comp_gypsum', title: 'Gypsum (invented)', year: '2026', distributor: '', budget: 750_000, domestic: 700_000, worldwide: 1_100_000, note: 'Released by its makers, online.', source: '', group: 'Streaming first' },
  ];
  const research = [
    { id: 'rs_siblings', kind: 'market', title: 'Sisters, not sidekicks', body: 'Six in ten art-house regulars in an invented survey said they want more films about adult siblings.', url: SURVEY },
    { id: 'rs_desert', kind: 'market', title: 'Open country travels', body: 'In an invented ten-year sample, road films earned back their budgets twice as often as city dramas.', url: BOX },
    { id: 'rs_small', kind: 'market', title: 'Small is the point', body: 'Buyers in an invented poll called "made for under a million" a reason to look, not a reason to pass.', url: BUYERS },
  ];
  const team = [
    { id: 'tm_wren', name: 'Wren Calloway', role: 'Writer and director', bio: 'Two short films, both shot in the desert in under a week.' },
    { id: 'tm_dana', name: 'Dana Okafor', role: 'Line producer', bio: 'Five features brought in on budget, none over a million.' },
    { id: 'tm_ines', name: 'Ines Calderón', role: 'Director of photography', bio: 'Shoots by available light. Her last feature used four lamps.' },
    { id: 'tm_theo', name: 'Theo Lindqvist', role: 'Production designer', bio: 'Turned a closed motel into a working one for a series.' },
  ];

  const slides = [
    { id: 'cover', layout: 'cover', imageId: 'look_dawn', scrim: 0.55, paper: 'postcard', byline: 'Written and directed by Wren Calloway', footnote: 'A sample deck. The film, the people, the studies and every figure in it are invented.' },
    { id: 'why', layout: 'text', eyebrow: 'Why this film, why me', headline: 'I grew up one town over from nowhere.', punch: 'I know what that road does to a family.', body: why,
      columns: [{ label: 'Where', lines: ['One motel, one gas station, the flats'] }, { label: 'When', lines: ['Twelve shoot days in spring 2031'] }, { label: 'Who', lines: ['Two leads, six supporting parts'] }] },
    { id: 'gap', layout: 'cards', paper: 'mixed', eyebrow: 'The gap', headline: 'Audiences are asking for this film.', punch: 'Nobody is making it.',
      cards: research.map((r, i) => ({ id: `gap${i + 1}`, kicker: 'Invented finding', title: r.title, body: r.body, footnote: r.url })),
      motion: { entrance: 'drop', order: 'one-by-one', stagger: 140 } },
    { id: 'opportunity', layout: 'comps', eyebrow: 'The opportunity', headline: 'Small road films have paid their way.', closing: 'Four invented films. None cost more than $1.4 million.',
      footnote: 'Every title here is invented for the sample. In your own deck, these are real films with sources.' },
    { id: 'audience', layout: 'stats', paper: 'torn', eyebrow: 'The audience', headline: 'Women over thirty buy the tickets.', punch: 'This film is about them.',
      lead: { value: '7 in 10', text: 'art-house tickets in the survey were bought by women over thirty.', source: SURVEY },
      stats: [
        { id: 'stat_friend', value: '41%', label: 'went to a film because a friend sent them the trailer', source: SURVEY },
        { id: 'stat_listen', value: '2.3x', label: 'as likely to rent a film they first heard about on a podcast', source: LISTENERS },
        { id: 'stat_road', value: '58%', label: 'call a road film a reason to leave the house', source: SURVEY },
      ],
      quote: { text: 'I would drive two hours to see my sister and me on a screen.', by: `A respondent, ${SURVEY}` },
      closing: 'How we reach them: a festival first, then the podcasts and newsletters they already trust.',
      motion: { count: true } },
    { id: 'story', layout: 'photo', imageId: 'look_flats', scrim: 0.6, eyebrow: 'The story', headline: 'A letter, a dead car and a stone on the flats.', body: story },
    { id: 'team', layout: 'team', paper: 'letter', eyebrow: 'The team', headline: 'People who make small films work.',
      aside: { title: 'Also attached', lines: ['Casting: an invented casting office', 'Music: an invented composer, on a package'], footnote: 'Everyone on this slide is invented.' } },
    { id: 'plan', layout: 'timeline', eyebrow: 'The plan', headline: 'Twelve days, one unit, one stretch of desert.',
      milestones: [
        { id: 'ms_close', when: 'Autumn 2030', what: 'Financing closes' },
        { id: 'ms_shoot', when: 'Spring 2031', what: 'Twelve shoot days' },
        { id: 'ms_post', when: 'Summer 2031', what: 'Edit, sound and colour' },
        { id: 'ms_out', when: 'Winter 2032', what: 'Festival premiere' },
      ],
      closing: 'Every set is within twenty minutes of the motel, so no day is lost to a company move.' },
    { id: 'model', layout: 'model', eyebrow: 'The model', headline: 'Everyone who makes the film shares in it.', body: 'Cast and crew work at scale and hold points in a shared pool. Investors are paid from the first dollar the film earns.', closing: 'The same terms for every investor.' },
    { id: 'ways', layout: 'ways', paper: 'postcard', eyebrow: 'Ways to take part', headline: 'Three ways in.',
      cards: [
        { id: 'invest', title: 'Invest', body: 'You take 60 cents of every dollar the film earns until you have 120% back, then half of everything after.', footnote: 'From $10,000.' },
        { id: 'give', title: 'Give', body: 'A grant or a gift through the film\'s fiscal sponsor. It is never repaid, and it lowers what investors put in.', footnote: 'The fiscal sponsor keeps 7% of each gift.' },
        { id: 'lend', title: 'Lend', body: 'A location, a truck, a week of your time. Help in kind comes off the budget as cash does.', footnote: 'Credited on screen.' },
      ],
      motion: { order: 'one-by-one', stagger: 160 } },
    { id: 'numbers', layout: 'numbers', eyebrow: 'The numbers', headline: 'What investors fund,', punch: 'and what comes back.', body: 'Three cases, from a quiet release to a good one. In the low case investors do not get their money back.' },
    { id: 'ask', layout: 'ask', eyebrow: 'The ask', nextStep: 'Next: a twenty-minute call this month, and the script if you would like to read it.', contact: 'wren@example.com' },
    { id: 'closing', layout: 'closing', imageId: 'look_dusk', scrim: 0.5 },
  ];

  const pitch = {
    logline, why,
    audience: {
      primary: 'Women over thirty who go to independent films with a sister, a mother or a friend.',
      secondary: 'Anyone who has driven a long way with family and not talked about why.',
      notes: 'A festival first, then the podcasts and newsletters this audience already trusts.',
    },
    sections: [{ id: 'sec_story', heading: 'The story', body: story }],
    comps,
    revenue: [
      { id: 'rv_dom', source: 'Domestic (theatrical + streaming license)', low: 500_000, mid: 1_300_000, high: 2_800_000 },
      { id: 'rv_intl', source: 'International sales', low: 250_000, mid: 700_000, high: 1_400_000 },
      { id: 'rv_tvod', source: 'TVOD / AVOD / library', low: 150_000, mid: 400_000, high: 800_000 },
    ],
    feePct: 20, deck: '', sources: [],
    design, lookbook, research, team, ask: '',
    slides,
    recipients: [
      { id: 'to_ada', slug: 'ada-example', name: 'Ada Example', coverLine: 'Prepared for Ada Example.', note: 'Ada, you asked what the raise is if no grant comes in. This copy opens on that number.', lead: 'without-grants' },
      { id: 'to_fund', slug: 'placeholder-fund', name: 'Placeholder Fund', coverLine: 'Prepared for the Placeholder Fund.', note: 'The Give card is the one that fits how the Fund works: a grant through our fiscal sponsor.', lead: 'with-grants', highlightCardId: 'give' },
    ],
  };
  // grants through a fiscal sponsor, so the deck has two asks: the raise with them and the raise without
  return { waterfall: { nonRecoupable: 90_000, sponsorFeePct: 7 }, pitch };
}
