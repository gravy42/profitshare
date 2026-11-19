// AI assist for the deck, with stubbed answers: what each request sends, and what is kept of each answer.
import { describe, expect, it } from 'vitest';
import type { DeckData, DeckSlide } from '../deck-runtime/data';
import {
  COVER_MAX,
  CRITIQUE_NOT_SENT,
  CRITIQUE_SENDS,
  CRITIQUE_SENT,
  critiqueRequest,
  critiqueTool,
  deckChecks,
  NOTE_MAX,
  PERSON_SENT,
  personRequest,
  personSends,
  personTool,
  PROBLEMS_MAX,
  PROMISE_TEXT,
  promisesReturns,
  PUNCH_SENDS,
  PUNCH_SENT,
  punchRequest,
  readCritiqueReply,
  readPersonReply,
  readPunchReply,
  slideText,
} from './aiDeck';
import { NOT_IN_FORM } from './aiMotion';
import { sampleDemo } from '../data/seed';
import { applyDeal } from './deal';
import { deckData } from './deckData';

const MALFORMED: unknown[] = [
  null,
  undefined,
  'text',
  7,
  true,
  [],
  [{ options: ['x'], problems: [], cover_line: 'x' }],
];

const slides: DeckSlide[] = [
  {
    id: 'cover',
    layout: 'cover',
    title: 'SALT FLAT',
    tagline: 'Two sisters, one dead car.',
    byline: 'Written and directed by Ada Example',
  },
  {
    id: 'gap',
    layout: 'cards',
    eyebrow: 'The gap',
    headline: 'Nobody is making this.',
    cards: [
      {
        id: 'c1',
        kicker: 'Finding',
        title: 'Invented finding',
        body: 'An invented body.',
        footnote: 'Invented Audience Survey, 2030',
      },
    ],
  },
  {
    id: 'audience',
    layout: 'stats',
    lead: { value: '7 in 10', text: 'invented buyers', source: 'Invented Survey, 2030' },
    stats: [{ id: 's1', value: '41%', label: 'an invented share', source: 'Invented Survey, 2030' }],
    quote: { text: 'I would drive two hours.', by: 'an invented respondent' },
  },
  { id: 'numbers', layout: 'numbers', body: 'What comes back in three cases.', caseNote: 'Fees come off the top.' },
  {
    id: 'ask',
    layout: 'ask',
    eyebrow: 'The ask',
    withGrants: 'We are raising {investors} from investors. Grants cover another {grants}.',
    withoutGrants: 'We are raising {investors} from investors.',
    nextStep: 'A twenty-minute call this month.',
    contact: 'ada@example.com',
  },
];
const deck = (over: Partial<DeckData> = {}): DeckData => ({
  version: 1,
  film: 'SALT FLAT',
  coverLine: 'Investor deck.',
  theme: {
    name: '',
    colors: {
      bg: '#111',
      ink: '#eee',
      accent: '#e0a84a',
      accent2: '#8fb0d8',
      muted: '#999',
      card: '#f1e9d6',
      cardInk: '#1b1608',
      line: '#999',
    },
    fonts: { title: '', body: '' },
    signoff: '',
  },
  images: [{ id: 'img', src: 'data:image/png;base64,SECRETPIXELS', alt: 'A picture' }],
  slides,
  recipients: [
    {
      slug: 'ada-example',
      name: 'Ada Example',
      coverLine: 'Prepared for Ada Example.',
      note: 'A note only Ada reads.',
      lead: 'with-grants',
    },
    { slug: 'placeholder-fund', name: 'Placeholder Fund', coverLine: '', lead: 'without-grants' },
  ],
  paths: {
    cashBudget: 987_654,
    deferred: 0,
    sources: [{ key: 'grants', label: 'Grants', amount: 123_456, on: true }],
    waterfall: { model: 'off-the-gross', recoupPct: 120, poolPct: 50, grossSharePct: 40 },
    cases: [{ label: 'Mid', gross: 2_345_678 }],
    feePct: 20,
  },
  currency: 'USD',
  legal: 'Illustrative only.',
  ...over,
});

describe('for a person', () => {
  const brief = {
    about: 'Ada Example backs first features set in the desert.\nShe likes small crews.',
    film: 'SALT FLAT',
    logline: 'Two sisters push a dead car across a desert.',
    askWith: 'We are raising $500,000 from investors.',
    askWithout: 'We are raising $650,000 from investors.',
    hasGrants: true,
  };
  it('sends what was pasted, the title, the logline and the two ask sentences, and nothing else', () => {
    const req = personRequest(brief);
    expect(req.prompt).toBe(
      [
        'ABOUT THE PERSON (pasted by the filmmaker):\nAda Example backs first features set in the desert.\nShe likes small crews.',
        'THE FILM: SALT FLAT',
        'LOGLINE: Two sisters push a dead car across a desert.',
        'THE ASK, WITH GRANTS COUNTED: We are raising $500,000 from investors.\n\nTHE ASK, WITHOUT GRANTS: We are raising $650,000 from investors.',
      ].join('\n\n'),
    );
    expect(req.system).toMatch(/No flattery/);
    expect(req.system).toMatch(/never invent a fact about them/);
    expect(req.system).toMatch(/Never say or suggest what the investment will return/);
    expect(personRequest({ ...brief, hasGrants: false }).prompt).toContain('THE ASK: We are raising $500,000');
    expect(personRequest({ ...brief, hasGrants: false }).prompt).not.toContain('WITHOUT GRANTS');
    expect(
      (personTool(false).input_schema as { properties: { lead: { enum: string[] } } }).properties.lead.enum,
    ).toEqual(['with-grants']);
    expect(personSends(true)).toBe(
      "Sent to Anthropic with your key: what you paste here, the film's title, its logline, and the two ask sentences from your deck, with the amounts in them (what you are raising and the grants figure). Not sent: your budget lines, anyone else you send the deck to, your slides, or pictures. What you paste is not saved in the project.",
    );
    expect(personSends(false)).toContain(
      'the ask sentence from your deck, with the amount in it (what you are raising)',
    );
    // one list makes both the prompt and the sentence: every part of the prompt is a part the sentence names
    expect(req.prompt.split(/\n\n(?=[A-Z ,]+(?: \(.*\))?:)/).length).toBe(PERSON_SENT.length + 1); // the asks part is two sentences
    for (const part of PERSON_SENT) {
      expect(req.prompt).toContain(part.write(brief));
      expect(personSends(true)).toContain(part.words(true));
    }
    expect(req.prompt).toBe(PERSON_SENT.map(part => part.write(brief)).join('\n\n'));
  });
  it('a good answer comes back as it is', () => {
    expect(
      readPersonReply(
        {
          cover_line: 'Prepared for Ada Example.',
          note: 'You said small crews. This one is twelve days and thirty-eight people.',
          lead: 'without-grants',
        },
        true,
      ),
    ).toEqual({
      coverLine: 'Prepared for Ada Example.',
      note: 'You said small crews. This one is twelve days and thirty-eight people.',
      lead: 'without-grants',
      flagged: false,
    });
  });
  it('caps the lengths, flattens line breaks, keeps markup as text and falls back on the with-grants ask', () => {
    const got = readPersonReply(
      {
        cover_line: `For <b>Ada</b>\n${'x'.repeat(300)}`,
        note: `<script>alert(1)</script> ${'n'.repeat(900)}`,
        lead: 'both',
        extra: 'ignored',
        highlightCardId: 'invest',
      },
      true,
    );
    expect(got.coverLine.length).toBeLessThanOrEqual(COVER_MAX);
    expect(got.coverLine.startsWith('For <b>Ada</b> xxx')).toBe(true);
    expect(got.note.length).toBeLessThanOrEqual(NOTE_MAX);
    expect(got.note.startsWith('<script>alert(1)</script> nnn')).toBe(true);
    expect(got.lead).toBe('with-grants');
    expect(Object.keys(got).sort()).toEqual(['coverLine', 'flagged', 'lead', 'note']);
    expect(readPersonReply({ cover_line: 'x', note: '', lead: 'without-grants' }, false).lead).toBe('with-grants'); // a deck with no grants has one ask
  });
  it('flags a note that promises returns, and refuses an answer with nothing in it', () => {
    expect(
      readPersonReply(
        { cover_line: 'For Ada.', note: 'You will double your money in two years.', lead: 'with-grants' },
        true,
      ).flagged,
    ).toBe(true);
    for (const raw of [{}, { cover_line: 7, note: null }, { cover_line: '  ', note: '\n' }])
      expect(() => readPersonReply(raw, true)).toThrow('no cover line and no note');
    for (const raw of MALFORMED) expect(() => readPersonReply(raw, true), String(raw)).toThrow(NOT_IN_FORM);
  });
});

describe('a second line', () => {
  it("sends the slide's headline and its own text only", () => {
    const req = punchRequest('Nobody is making this.', 'An invented paragraph.');
    expect(req.prompt).toBe("HEADLINE: Nobody is making this.\n\nTHE SLIDE'S TEXT:\nAn invented paragraph.");
    expect(punchRequest('', '').prompt).toBe("HEADLINE: (none yet)\n\nTHE SLIDE'S TEXT:\n(none)");
    expect(PUNCH_SENDS).toBe(
      "Sent to Anthropic with your key: this slide's headline, and the slide's own text (its paragraphs, cards, numbers and quote). Not sent: anything else on the deck, pictures, or your budget.",
    );
    expect(punchRequest('H', 'B').prompt).toBe(PUNCH_SENT.map(part => part.write('H', 'B')).join('\n\n'));
  });
  it('gives up to three lines: none empty, none twice, none the headline again, each one capped line; a promise is kept for the page to flag', () => {
    expect(readPunchReply({ options: ['So we are.', 'Until now.', 'That is the opening.'] })).toEqual([
      'So we are.',
      'Until now.',
      'That is the opening.',
    ]);
    const got = readPunchReply(
      {
        options: [
          '  So we are.  ',
          'so we are.',
          '',
          7,
          null,
          'Nobody is making this.',
          'A guaranteed return.',
          `Line\ntwo ${'z'.repeat(300)}`,
          'Fourth',
          'Fifth',
        ],
      },
      'Nobody is making this.',
    );
    expect(got).toHaveLength(3);
    expect(got[0]).toBe('So we are.');
    expect(got[1]).toBe('A guaranteed return.');
    expect(promisesReturns(got[1])).toBe(true);
    expect(got[2].startsWith('Line two zzz')).toBe(true);
    expect(got[2].length).toBeLessThanOrEqual(90);
    expect(readPunchReply({ options: ['<i>Markup</i> stays text'] })).toEqual(['<i>Markup</i> stays text']);
  });
  it('refuses an answer with no line in it', () => {
    for (const raw of [{}, { options: 'So we are.' }, { options: [] }, { options: ['', null] }])
      expect(() => readPunchReply(raw)).toThrow('no usable line');
    for (const raw of MALFORMED) expect(() => readPunchReply(raw), String(raw)).toThrow(NOT_IN_FORM);
  });
});

describe('a read of the deck', () => {
  it('sends the words on the slides, with their ids and layouts: no pictures, no people, no figures from the budget', () => {
    const req = critiqueRequest(deck());
    expect(req.prompt).toContain('### slide 2 | id=gap | layout=cards');
    expect(req.prompt).toContain('headline (headline): Nobody is making this.');
    expect(req.prompt).toContain('number (numbers): 41% an invented share (source: Invented Survey, 2030)');
    expect(req.prompt).toContain('paragraph (ask): We are raising {investors} from investors.');
    expect(req.prompt).toContain('contact (contact): ada@example.com');
    const all = JSON.stringify(req);
    for (const secret of [
      'SECRETPIXELS',
      'data:image',
      'Ada Example.',
      'A note only Ada reads',
      'Placeholder Fund',
      'placeholder-fund',
      '987',
      '123,456',
      '123456',
      '2345678',
      'Illustrative only',
    ])
      expect(all, secret).not.toContain(secret);
    expect(
      (
        critiqueTool(['a', 'b']).input_schema as {
          properties: { problems: { maxItems: number; items: { properties: { slide_id: { enum: string[] } } } } };
        }
      ).properties.problems.items.properties.slide_id.enum,
    ).toEqual(['a', 'b']);
    expect(req.system).toMatch(/the deck must never promise returns/);
    expect(CRITIQUE_SENDS).toBe(
      "Everything written on your slides is sent: headlines, paragraphs, cards, numbers and their sources, team names and bios, comparable film titles, the deal terms shown on the model slide, your contact line, and the film's title. Not sent: your budget lines, the figures on the money slide, pictures, or the people you send the deck to.",
    );
    expect(CRITIQUE_NOT_SENT).toHaveLength(4);
  });
  it('keeps the problems on slides the deck has, eight at most, each one capped line of plain text', () => {
    const ids = slides.map(s => s.id);
    const many = Array.from({ length: 12 }, (_, i) => ({
      slide_id: 'gap',
      field: 'cards',
      kind: 'vague',
      problem: `Problem ${i}`,
    }));
    expect(readCritiqueReply({ problems: many }, ids)).toHaveLength(PROBLEMS_MAX);
    const got = readCritiqueReply(
      {
        problems: [
          {
            slide_id: 'gap',
            field: 'headline',
            kind: 'empty-headline',
            problem: 'The headline says nothing an investor can check.',
          },
          { slide_id: 'nope', field: 'body', kind: 'vague', problem: 'A slide that is not on the deck.' },
          {
            slide_id: 'ask',
            field: 'everything',
            kind: 'catastrophe',
            problem: `<a href="https://example.com">click</a>\n${'p'.repeat(900)}`,
            fix: 'ignored',
          },
          {
            slide_id: 'gap',
            field: 'headline',
            kind: 'empty-headline',
            problem: 'The headline says nothing an investor can check.',
          },
          { slide_id: 'audience', kind: 'promise', problem: '' },
          { slide_id: 7, problem: 'x' },
          null,
          'text',
        ],
      },
      ids,
    );
    expect(got.map(p => p.slideId)).toEqual(['gap', 'ask']);
    expect(got[0]).toEqual({
      slideId: 'gap',
      field: 'headline',
      kind: 'empty-headline',
      message: 'The headline says nothing an investor can check.',
    });
    expect(got[1].field).toBe('other');
    expect(got[1].kind).toBe('other');
    expect(got[1].message.startsWith('<a href="https://example.com">click</a> ppp')).toBe(true);
    expect(got[1].message.length).toBeLessThanOrEqual(220);
    expect(got[1].message).not.toMatch(/\n/);
  });
  it('only a list is an answer: an empty one is "nothing to report", anything else is an error, never "nothing found"', () => {
    expect(readCritiqueReply({ problems: [] }, ['gap'])).toEqual([]);
    for (const raw of [...MALFORMED, {}, { problems: 'none' }, { problems: {} }, { problems: null }])
      expect(() => readCritiqueReply(raw, ['gap']), JSON.stringify(raw)).toThrow(NOT_IN_FORM);
  });
  it('the sentence about what is sent names every kind of thing that is sent, and nothing is sent that it does not name', () => {
    // the sample deck has one slide of every layout: read every word of it and collect the kinds
    const full = deckData(applyDeal(sampleDemo()), { today: '2030-09-01' });
    const kinds = new Set<string>(['film']); // the title rides at the top of the request
    for (const s of full.slides) for (const t of slideText(s)) kinds.add(t.kind);
    const listed = CRITIQUE_SENT.map(k => k[0]);
    expect([...kinds].sort()).toEqual([...listed].sort());
    for (const [, words] of CRITIQUE_SENT) expect(CRITIQUE_SENDS).toContain(words);
    // and the request is made of nothing but those labelled lines, the slide headers and the title
    const req = critiqueRequest(full);
    for (const l of req.prompt.split('\n').filter(Boolean))
      expect(
        /^(THE FILM: |THE DECK, SLIDE BY SLIDE:|### slide \d+ \| id=|\(no words of its own\))/.test(l) ||
          listed.some(k => l.startsWith(`${k} (`)) ||
          /^[^:]*$|^(?![a-z]+ \()/.test(l),
        l,
      ).toBe(true);
    const labels = req.prompt
      .split('\n')
      .map(l => /^([a-z]+) \([A-Za-z]+\): /.exec(l)?.[1])
      .filter(Boolean);
    expect(labels.length).toBeGreaterThan(40);
    for (const k of labels) expect(listed).toContain(k);
    expect(req.prompt).not.toMatch(/cash budget|speaking parts|Ada Example|Placeholder/);
    for (const figure of [full.paths.cashBudget, full.paths.sources[0].amount, ...full.paths.cases.map(c => c.gross)])
      expect(req.prompt.replace(/,/g, '')).not.toContain(String(Math.round(figure))); // no figure from the budget, nobody the deck is sent to
  });
});

describe('the checks that need no model', () => {
  it('finds text that reads as a promise of returns, and leaves what the deck may say alone', () => {
    for (const t of [
      'A guaranteed 3x.',
      'Investors will double their money.',
      'This is risk-free.',
      "You can't lose.",
      "You'll make it back in a year.",
      'Returns are certain.',
      'A sure thing.',
    ])
      expect(promisesReturns(t), t).toBe(true);
    for (const t of [
      'In the mid case the model shows 2.1x.',
      'Investors recoup 120% first, then share half.',
      'The figures are illustrative, not a promise of returns.',
      'We will shoot in March.',
      'Nobody is making this film.',
      '',
      null,
      7,
    ])
      expect(promisesReturns(t), String(t)).toBe(false);
  });
  it('reports a promise on the slide and field it is in, once a field, and an ask with no next step or no contact', () => {
    const bad: DeckSlide[] = [
      {
        id: 'why',
        layout: 'text',
        headline: 'A guaranteed return.',
        body: 'You will double your money. It is risk-free.',
      },
      {
        id: 'ask',
        layout: 'ask',
        withGrants: 'We are raising {investors}.',
        withoutGrants: 'We are raising {investors}.',
        nextStep: '',
        contact: ' ',
      },
    ];
    expect(deckChecks(deck({ slides: bad, recipients: [] }))).toEqual([
      { slideId: 'why', field: 'headline', message: `${PROMISE_TEXT} ("guaranteed")` },
      { slideId: 'why', field: 'body', message: `${PROMISE_TEXT} ("double your money")` },
      { slideId: 'ask', field: 'contact', message: 'The ask does not say how to reach you.' },
      { slideId: 'ask', field: 'nextStep', message: 'The ask does not say what you want the reader to do next.' },
    ]);
    expect(deckChecks(deck())).toEqual([]);
    expect(
      deckChecks(
        deck({
          recipients: [
            {
              slug: 'x',
              name: 'Ada Example',
              coverLine: '',
              note: 'A guaranteed return for you.',
              lead: 'with-grants',
            },
          ],
        }),
      ),
    ).toEqual([{ slideId: 'recipient:x', field: 'note', message: `Ada Example: ${PROMISE_TEXT} ("guaranteed")` }]);
    expect(deckChecks({} as DeckData)).toEqual([]);
  });
  it("reads every layout's words", () => {
    expect(slideText(slides[1]).map(t => t.field)).toEqual(['eyebrow', 'headline', 'cards']);
    expect(slideText(slides[3])).toEqual([
      { field: 'body', kind: 'paragraph', text: 'What comes back in three cases.' },
      { field: 'closing', kind: 'paragraph', text: 'Fees come off the top.' },
    ]);
  });
});
