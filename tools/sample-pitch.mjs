// The sample film's pitch: its look book (drawn by tools/sample-art.mjs, by arithmetic), a design system worked out from those pictures
// by the app's own palette engine, and a whole pitch deck. Everything is invented: the film, the people, the studies,
// the numbers. Nothing is read from disk or the network and nothing depends on the clock or on chance, so the same
// script always writes the same file. Called by tools/make-sample.mjs.

import { drawPictures } from './sample-art.mjs';

// the film's mark: a low sun on the horizon, on nothing (it sits on whatever is behind it)
const MARK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="300" viewBox="0 0 480 300"><path d="M150 214a90 90 0 0 1 180 0Z" fill="#f2b24a"/><rect x="40" y="214" width="400" height="14" rx="7" fill="#f4eddc"/><rect x="110" y="246" width="260" height="10" rx="5" fill="#f4eddc" opacity=".7"/><rect x="180" y="274" width="120" height="8" rx="4" fill="#f4eddc" opacity=".45"/></svg>';

const dataUrl = svg => `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;

// ---------- the pitch ----------

const SURVEY = 'Invented Audience Survey, 2030',
  LISTENERS = 'Invented Listener Study, 2030',
  BOX = 'Invented Box Office Review, 2029',
  BUYERS = 'Invented Buyers Poll, 2030';

/** `engine` is the app's own palette code (src/engine/palette.ts), so the sample's colours are what the app would propose. */
export function buildSamplePitch(engine) {
  const drawn = drawPictures();
  const lookbook = [
    ...drawn.map(d => ({ id: d.id, dataUrl: dataUrl(d.svg), caption: d.caption, section: d.section })),
    {
      id: 'look_mark',
      dataUrl: dataUrl(MARK_SVG),
      caption: "The film's mark: a low sun on the horizon (drawn for the sample)",
      section: 'reference',
    },
  ];
  const night = engine
    .proposeThemes(
      engine.quantize(
        drawn.flatMap(d => d.pixels),
        8,
      ),
    )
    .find(p => p.id === 'night');
  const failed = engine.checkTheme(night.colors).filter(c => !c.pass);
  if (failed.length)
    throw new Error(`the sample's palette fails its own checks: ${failed.map(f => f.label).join(', ')}`);
  const pair = engine.TYPE_PAIRINGS[0];
  const { card, ...colors } = night.colors;
  const design = {
    name: 'Salt Flat',
    colors,
    card,
    fonts: { title: pair.title, body: pair.body },
    paperShade: 'aged',
    hand: true,
    notes:
      'Worked out from the look book: a dusk ground, a pale salt card, a dusty rose accent and the blue of the sky over the flats. Typewriter titles, plain text, handwriting on aged paper.',
    deck: { coverImageId: 'look_sign', closingImageId: 'look_wagon', signoff: 'Thank you for reading' },
  };

  const logline =
    "Two estranged sisters push a dead station wagon across the desert to deliver their mother's last letter.";
  const story =
    'Lena wants the letter burned. June wants it read. Their mother asked for it to be left under a stone on the salt flats, and the only way there is together.\n\nBy the time they reach the stone, the car is the least broken thing they have fixed.';
  const why =
    'I spent my summers in a motel my aunt ran at the edge of a dry lake. Nobody stayed more than a night, and everybody told her more than they meant to.\n\nSalt Flat is that place and those people: one road, one motel, two sisters who have run out of ways to avoid each other. I wrote it for what a small crew can shoot well in twelve days.';

  const comps = [
    {
      id: 'comp_alkali',
      title: 'Alkali Sisters (invented)',
      year: '2027',
      distributor: '',
      budget: 600_000,
      domestic: 1_900_000,
      worldwide: 3_100_000,
      note: 'Festival premiere, then a small theatrical run.',
      source: '',
      group: 'Festival first',
    },
    {
      id: 'comp_shoulder',
      title: 'The Long Shoulder (invented)',
      year: '2028',
      distributor: '',
      budget: 900_000,
      domestic: 1_500_000,
      worldwide: 2_600_000,
      note: 'Festival premiere, sold for streaming.',
      source: '',
      group: 'Festival first',
    },
    {
      id: 'comp_mile',
      title: 'Mile Marker 40 (invented)',
      year: '2029',
      distributor: '',
      budget: 1_400_000,
      domestic: 2_000_000,
      worldwide: 3_200_000,
      note: 'Sold to a streamer before its premiere.',
      source: '',
      group: 'Streaming first',
    },
    {
      id: 'comp_gypsum',
      title: 'Gypsum (invented)',
      year: '2026',
      distributor: '',
      budget: 750_000,
      domestic: 700_000,
      worldwide: 1_100_000,
      note: 'Released by its makers, online.',
      source: '',
      group: 'Streaming first',
    },
  ];
  const research = [
    {
      id: 'rs_siblings',
      kind: 'market',
      title: 'Sisters, not sidekicks',
      body: 'Six in ten art-house regulars in an invented survey said they want more films about adult siblings.',
      url: SURVEY,
    },
    {
      id: 'rs_desert',
      kind: 'market',
      title: 'Open country travels',
      body: 'In an invented ten-year sample, road films earned back their budgets twice as often as city dramas.',
      url: BOX,
    },
    {
      id: 'rs_small',
      kind: 'market',
      title: 'Small is the point',
      body: 'Buyers in an invented poll called "made for under a million" a reason to look, not a reason to pass.',
      url: BUYERS,
    },
  ];
  const team = [
    {
      id: 'tm_wren',
      name: 'Wren Calloway',
      role: 'Writer and director',
      bio: 'Two short films, both shot in the desert in under a week.',
    },
    {
      id: 'tm_dana',
      name: 'Dana Okafor',
      role: 'Line producer',
      bio: 'Five features brought in on budget, none over a million.',
    },
    {
      id: 'tm_ines',
      name: 'Ines Calderón',
      role: 'Director of photography',
      bio: 'Shoots by available light. Her last feature used four lamps.',
    },
    {
      id: 'tm_theo',
      name: 'Theo Lindqvist',
      role: 'Production designer',
      bio: 'Turned a closed motel into a working one for a series.',
    },
  ];

  const slides = [
    {
      id: 'cover',
      layout: 'cover',
      imageId: 'look_sign',
      scrim: 0.45,
      paper: 'postcard',
      byline: 'Written and directed by Wren Calloway',
      footnote: 'A sample deck. The film, the people, the studies and every figure in it are invented.',
    },
    {
      id: 'why',
      layout: 'text',
      eyebrow: 'Why this film, why me',
      headline: 'I grew up one town over from nowhere.',
      punch: 'I know what that road does to a family.',
      body: why,
      columns: [
        { label: 'Where', lines: ['One motel, one gas station, the flats'] },
        { label: 'When', lines: ['Twelve shoot days in spring 2031'] },
        { label: 'Who', lines: ['Two leads, six supporting parts'] },
      ],
    },
    {
      id: 'gap',
      layout: 'cards',
      paper: 'mixed',
      eyebrow: 'The gap',
      headline: 'Audiences are asking for this film.',
      punch: 'Nobody is making it.',
      cards: research.map((r, i) => ({
        id: `gap${i + 1}`,
        kicker: 'Invented finding',
        title: r.title,
        body: r.body,
        footnote: r.url,
      })),
      motion: { entrance: 'drop', order: 'one-by-one', stagger: 140 },
    },
    {
      id: 'opportunity',
      layout: 'comps',
      eyebrow: 'The opportunity',
      headline: 'Small road films have paid their way.',
      closing: 'Four invented films. None cost more than $1.4 million.',
      footnote: 'Every title here is invented for the sample. In your own deck, these are real films with sources.',
    },
    {
      id: 'audience',
      layout: 'stats',
      paper: 'torn',
      eyebrow: 'The audience',
      headline: 'Women over thirty buy the tickets.',
      punch: 'This film is about them.',
      lead: {
        value: '7 in 10',
        text: 'art-house tickets in the survey were bought by women over thirty.',
        source: SURVEY,
      },
      stats: [
        {
          id: 'stat_friend',
          value: '41%',
          label: 'went to a film because a friend sent them the trailer',
          source: SURVEY,
        },
        {
          id: 'stat_listen',
          value: '2.3x',
          label: 'as likely to rent a film they first heard about on a podcast',
          source: LISTENERS,
        },
        { id: 'stat_road', value: '58%', label: 'call a road film a reason to leave the house', source: SURVEY },
      ],
      quote: { text: 'I would drive two hours to see my sister and me on a screen.', by: `A respondent, ${SURVEY}` },
      closing: 'How we reach them: a festival first, then the podcasts and newsletters they already trust.',
      motion: { count: true },
    },
    {
      id: 'story',
      layout: 'photo',
      imageId: 'look_flats',
      scrim: 0.45,
      eyebrow: 'The story',
      headline: 'A letter, a dead car and a stone on the flats.',
      body: story,
    },
    {
      id: 'look',
      layout: 'look',
      eyebrow: 'The look',
      headline: 'Dusk, salt and one long road.',
      looks: ['look_motel', 'look_door', 'look_pool', 'look_moon', 'look_dunes', 'look_road'],
    },
    {
      id: 'team',
      layout: 'team',
      paper: 'letter',
      eyebrow: 'The team',
      headline: 'People who make small films work.',
      aside: {
        title: 'Also attached',
        lines: ['Casting: an invented casting office', 'Music: an invented composer, on a package'],
        footnote: 'Everyone on this slide is invented.',
      },
    },
    {
      id: 'plan',
      layout: 'timeline',
      eyebrow: 'The plan',
      headline: 'Twelve days, one unit, one stretch of desert.',
      milestones: [
        { id: 'ms_close', when: 'Autumn 2030', what: 'Financing closes' },
        { id: 'ms_shoot', when: 'Spring 2031', what: 'Twelve shoot days' },
        { id: 'ms_post', when: 'Summer 2031', what: 'Edit, sound and colour' },
        { id: 'ms_out', when: 'Winter 2032', what: 'Festival premiere' },
      ],
      closing: 'Every set is within twenty minutes of the motel, so no day is lost to a company move.',
    },
    {
      id: 'model',
      layout: 'model',
      eyebrow: 'The model',
      headline: 'Everyone who makes the film shares in it.',
      body: 'Cast and crew work at scale and hold points in a shared pool. Investors are paid from the first dollar the film earns.',
      closing: 'The same terms for every investor.',
    },
    {
      id: 'ways',
      layout: 'ways',
      paper: 'postcard',
      eyebrow: 'Ways to take part',
      headline: 'Three ways in.',
      cards: [
        {
          id: 'invest',
          title: 'Invest',
          body: 'You take 60 cents of every dollar the film earns until you have 120% back, then half of everything after.',
          footnote: 'From $10,000.',
        },
        {
          id: 'give',
          title: 'Give',
          body: "A grant or a gift through the film's fiscal sponsor. It is never repaid, and it lowers what investors put in.",
          footnote: 'The fiscal sponsor keeps 7% of each gift.',
        },
        {
          id: 'lend',
          title: 'Lend',
          body: 'A location, a truck, a week of your time. Help in kind comes off the budget as cash does.',
          footnote: 'Credited on screen.',
        },
      ],
      motion: { order: 'one-by-one', stagger: 160 },
    },
    {
      id: 'numbers',
      layout: 'numbers',
      eyebrow: 'The numbers',
      headline: 'What investors fund,',
      punch: 'and what comes back.',
      body: 'Three cases, from a quiet release to a good one. In the low case investors do not get their money back.',
    },
    {
      id: 'ask',
      layout: 'ask',
      eyebrow: 'The ask',
      nextStep: 'Next: a twenty-minute call this month, and the script if you would like to read it.',
      contact: 'wren@example.com',
    },
    { id: 'closing', layout: 'closing', imageId: 'look_wagon', scrim: 0.4 },
  ];

  const pitch = {
    logline,
    why,
    audience: {
      primary: 'Women over thirty who go to independent films with a sister, a mother or a friend.',
      secondary: 'Anyone who has driven a long way with family and not talked about why.',
      notes: 'A festival first, then the podcasts and newsletters this audience already trusts.',
    },
    sections: [{ id: 'sec_story', heading: 'The story', body: story }],
    comps,
    revenue: [
      {
        id: 'rv_dom',
        source: 'Domestic (theatrical + streaming license)',
        low: 500_000,
        mid: 1_300_000,
        high: 2_800_000,
      },
      { id: 'rv_intl', source: 'International sales', low: 250_000, mid: 700_000, high: 1_400_000 },
      { id: 'rv_tvod', source: 'TVOD / AVOD / library', low: 150_000, mid: 400_000, high: 800_000 },
    ],
    feePct: 20,
    deck: '',
    sources: [],
    design,
    lookbook,
    research,
    team,
    ask: '',
    slides,
    recipients: [
      {
        id: 'to_ada',
        slug: 'ada-example',
        name: 'Ada Example',
        coverLine: 'Prepared for Ada Example.',
        note: 'Ada, you asked what the raise is if no grant comes in. This copy opens on that number.',
        lead: 'without-grants',
      },
      {
        id: 'to_fund',
        slug: 'placeholder-fund',
        name: 'Placeholder Fund',
        coverLine: 'Prepared for the Placeholder Fund.',
        note: 'The Give card is the one that fits how the Fund works: a grant through our fiscal sponsor.',
        lead: 'with-grants',
        highlightCardId: 'give',
      },
    ],
  };
  // grants through a fiscal sponsor, so the deck has two asks: the raise with them and the raise without
  return { waterfall: { nonRecoupable: 90_000, sponsorFeePct: 7 }, pitch };
}
