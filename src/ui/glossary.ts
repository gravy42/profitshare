// The glossary's words, all in this one file so the wording can be edited in one place. No React here.
//
// DRAFT for the owner's review: docs/guide-draft-notes.md lists every definition that wants a second look.
//
// Each entry says how ProfitShare uses a word, which is not always how an agreement uses it. `term` is the word as the
// app's own labels have it; `also` holds the trade's names for the same thing, which are shown; `find` holds other words a person might type into the search box, which are not.
// `text` is one or two plain sentences. `see` points at related entries by id. Ids are part of the page address
// (#glossary-points), so changing one breaks links people may have saved.

type GlossaryGroupId = 'paying' | 'deal' | 'backend' | 'schedule' | 'elsewhere';

interface GlossaryGroup {
  id: GlossaryGroupId;
  title: string;
  intro?: string;
}

export interface GlossaryTerm {
  id: string;
  term: string;
  /** Other names for the same thing, shown under the definition. */
  also?: string[];
  /** Words that should find this entry in the search box but are not names for it, so they are not shown. */
  find?: string[];
  group: GlossaryGroupId;
  text: string;
  see?: string[];
}

/** Said at the top of the glossary, before any definition. */
export const GLOSSARY_NOTE =
  'This explains how ProfitShare uses each word. It is not legal advice, and an agreement can define the same word differently. Have an entertainment attorney read anything before anyone signs.';

export const GLOSSARY_GROUPS: GlossaryGroup[] = [
  { id: 'paying', title: 'Paying people' },
  { id: 'deal', title: 'The deal' },
  { id: 'backend', title: 'The back end' },
  { id: 'schedule', title: 'The schedule' },
  {
    id: 'elsewhere',
    title: 'In agreements, not in ProfitShare',
    intro: 'Words you will meet in an investor agreement that this app does not work out for you.',
  },
];

export const GLOSSARY: GlossaryTerm[] = [
  // ---- Paying people ----
  {
    id: 'pay-type',
    term: 'Pay type',
    group: 'paying',
    see: ['up-front', 'deferred', 'points'],
    text: 'How a budget line gets paid: up front, deferred or points. Every line has one, in the Pay column on the top sheet, and changing it reprices the whole film. Producer fees, the script purchase and star or cast allowances take theirs from the Deal tab, whatever the top sheet says.',
  },
  {
    id: 'up-front',
    term: 'Up front',
    also: ['cash'],
    find: ['upfront'],
    group: 'paying',
    see: ['budget-to-raise'],
    text: 'Paid during the production, so it is money you have to raise. A saved project file writes it as "cash".',
  },
  {
    id: 'deferred',
    term: 'Deferred',
    also: ['deferment', 'deferred compensation', 'fixed IOU'],
    find: ['deferments', 'deferral'],
    group: 'paying',
    see: ['total-production-cost', 'waterfall'],
    text: 'A fixed amount owed to someone and paid later, if the film takes in enough. ProfitShare pays all deferred pay first, before investors and the pool split anything; many investor agreements pay it only after investors recoup, or do not allow it. It counts, with its fringes, in the total production cost SAG-AFTRA measures.',
  },
  {
    id: 'points',
    term: 'Points',
    also: ['contingent participation', 'profit participation'],
    find: ['profit share'],
    group: 'paying',
    see: ['pool', 'points-tier'],
    text: "A share of the cast and crew pool, worth something only if the film makes money. In ProfitShare a person's points are days worked × their tier's multiplier × any bonus, or a fixed block, and their share of the pool is their points out of all the points on the schedule. One point is not one percent.",
  },
  {
    id: 'converted-to-points',
    term: 'Converted to points',
    also: ['Points value'],
    group: 'paying',
    see: ['points'],
    text: 'The dollar value of the budget lines you set to points: what people agreed not to take up front. The header calls it Points value. It records the trade and comes off the budget to raise; it does not give anyone more points, which come from the points schedule.',
  },
  {
    id: 'scale',
    term: 'Scale',
    find: ['minimum', 'day rate'],
    group: 'paying',
    see: ['sag-tier', 'everyone-at-scale'],
    text: "The least a SAG-AFTRA agreement lets you pay a performer. ProfitShare uses each tier's day rate, which covers an 8-hour day, with overtime on top for a longer one.",
  },
  {
    id: 'everyone-at-scale',
    term: 'Everyone at scale',
    also: ['the Sing Sing deal'],
    find: ['pay model', 'as budgeted'],
    group: 'paying',
    see: ['scale'],
    text: "One of the two pay models on the Deal tab. Cast are paid the target tier's scale ÷ 8 an hour; crew and producers are paid the 8-hour rate you choose there ÷ 8, the same tier's unless you change it. Overtime is on top, and the upside is split by points. The other model, As budgeted, keeps the rates on your lines.",
  },
  {
    id: 'above-scale',
    term: 'Above-scale ATL money',
    also: ['premiums'],
    find: ['producer fees', 'script purchase', 'star allowance', 'cast allowance'],
    group: 'paying',
    see: ['premium', 'atl-btl'],
    text: "Producer fees, the script purchase and star or cast allowances: the three places money above scale usually sits. The Deal tab can leave each one up front, move it to points or to deferred, or take it off the budget. The app sometimes calls these premiums, which is not the investor's premium.",
  },
  {
    id: 'floor-rate',
    term: 'Floor rate',
    also: ['cash floor'],
    find: ['non-shoot days', 'prep wrap post'],
    group: 'paying',
    text: 'An hourly rate for prep, wrap and post days, when you switch it on in the Deal tab. People are paid the floor up front for those days and the rest of their rate moves to points or to deferred. Shoot days are never touched.',
  },
  {
    id: 'fringes',
    term: 'Fringes',
    find: ['payroll taxes', 'P&H', 'pension and health', 'FICA', 'workers comp'],
    group: 'paying',
    text: "What an employer pays on top of a wage: payroll taxes, workers' comp, the payroll company's fee, SAG-AFTRA pension and health. Each is a percentage on a line's wages. Up front and deferred lines carry them; a line set to points carries none.",
  },
  {
    id: 'contingency',
    term: 'Contingency',
    group: 'paying',
    see: ['budget-to-raise', 'total-production-cost'],
    text: 'A percentage added to the budget for whatever goes wrong. ProfitShare figures it on up front costs and their fringes only and includes it in the budget to raise. A box on the Deal tab decides whether it counts towards total production cost.',
  },

  // ---- The deal ----
  {
    id: 'deal',
    term: 'The deal',
    find: ['terms', 'Deal tab'],
    group: 'deal',
    text: 'Every term of the film in one place, the Deal tab: day length, SAG-AFTRA tier, pay model, what happens to above-scale money, the floor rate, grants and the waterfall. It sits as a layer over the budget you brought in, which is never rewritten.',
  },
  {
    id: 'top-sheet',
    term: 'Top sheet',
    group: 'deal',
    text: "The one-page summary of a budget by category. ProfitShare's shows up front, deferred and points totals side by side.",
  },
  {
    id: 'atl-btl',
    term: 'Above the line, below the line',
    also: ['ATL', 'BTL'],
    group: 'deal',
    text: 'Above the line is story, producers, director and cast. Below the line is everything else: crew, equipment, locations, post. The top sheet totals the two separately.',
  },
  {
    id: 'budget-to-raise',
    term: 'Budget to raise',
    find: ['cash budget'],
    group: 'deal',
    see: ['investors-put-in', 'contingency'],
    text: 'Everything paid up front, with its fringes, plus contingency. It is the figure in the header and at the top of the top sheet. Move a line to points or deferred and it falls.',
  },
  {
    id: 'investors-put-in',
    term: 'Investors put in',
    also: ['invested capital'],
    find: ['equity', 'recoupable budget'],
    group: 'deal',
    see: ['recoupment', 'grants', 'incentives'],
    text: "The budget to raise, less grants and donations after the sponsor's fee, less any incentives you have switched on. This is the amount investors recoup in the waterfall.",
  },
  {
    id: 'sag-tier',
    term: 'SAG-AFTRA tier',
    find: [
      'Ultra Low Budget',
      'Moderate Low Budget',
      'Low Budget',
      'Theatrical Basic',
      'ULB',
      'MLB',
      'target tier',
      'qualifies as',
    ],
    group: 'deal',
    see: ['cap', 'scale'],
    text: 'One of four theatrical agreements ProfitShare knows: Ultra Low Budget, Moderate Low Budget, Low Budget and Theatrical Basic. The tier sets the scale your cast is paid and the cap the film has to fit under. Target tier is the one you are aiming at; Qualifies as is the cheapest one your numbers fit today.',
  },
  {
    id: 'cap',
    term: 'Cap',
    find: ['budget cap', 'ceiling', 'headroom'],
    group: 'deal',
    see: ['total-production-cost', 'dic'],
    text: 'The most a film can cost and still use a tier. The SAG tier tab lists each one and says how far under or over you are. Theatrical Basic has none.',
  },
  {
    id: 'total-production-cost',
    term: 'Total production cost',
    find: ['TPC'],
    group: 'deal',
    see: ['cap', 'deferred'],
    text: 'What SAG-AFTRA measures against the cap. ProfitShare counts the budget to raise plus all deferred pay and its fringes. Points do not count, because they have no fixed value.',
  },
  {
    id: 'dic',
    term: 'DIC',
    also: ['Diversity in Casting incentive'],
    group: 'deal',
    see: ['cap'],
    text: 'A SAG-AFTRA incentive that raises the cap on the Moderate Low Budget and Low Budget tiers for films that meet its casting rules. ProfitShare uses the higher cap when you tick the box. It does not check whether your cast meets the rules.',
  },
  {
    id: 'day-out-of-days',
    term: 'Day out of days',
    also: ['DOOD'],
    find: ['day-out-of-days'],
    group: 'deal',
    see: ['stripboard'],
    text: "A chart of who works on which shoot day. ProfitShare builds it from the stripboard, and each actor's work days flow from it into their cast lines in the budget and their days on the points schedule.",
  },
  {
    id: 'premium',
    term: 'Premium',
    also: ['Investor recoup %'],
    find: ['investor premium', '120%', 'interest', 'multiple'],
    group: 'deal',
    see: ['recoupment', 'above-scale'],
    text: 'In an investor agreement, the extra an investor gets back on top of their money before profits are shared. In ProfitShare it is Investor recoup % on the Deal tab: 120 means investors recoup their money plus 20%. The app also says premiums for above-scale ATL money, which is a different thing.',
  },

  // ---- The back end ----
  {
    id: 'back-end',
    term: 'Back end',
    also: ['backend participation'],
    find: ['backend', 'upside'],
    group: 'backend',
    see: ['deferred', 'pool'],
    text: 'Money paid out of what the film earns, as opposed to what it costs to make. In ProfitShare the back end is deferred pay and the cast and crew pool.',
  },
  {
    id: 'waterfall',
    term: 'Waterfall',
    also: ['order of priority'],
    find: ['revenue waterfall'],
    group: 'backend',
    see: ['recoup-first', 'off-the-gross'],
    text: "The order in which money that comes in gets paid out. ProfitShare's order is: fees and expenses off the top, then deferred pay, then investors and the cast and crew pool, split by the model you pick on the Deal tab.",
  },
  {
    id: 'gross-proceeds',
    term: 'Gross proceeds',
    also: ['gross receipts'],
    find: ['gross'],
    group: 'backend',
    see: ['off-the-top', 'net-proceeds'],
    text: 'All the money the film takes in, from every source, before anyone takes a fee. ProfitShare calls it Gross receipts, and you type it in by source on the Pitch tab under What it could make.',
  },
  {
    id: 'off-the-top',
    term: 'Off-the-top deductions',
    also: ['approved deductions', 'fees and expenses off the top'],
    find: ['distributor fees', 'sales agent', 'distribution expenses', 'residuals'],
    group: 'backend',
    see: ['gross-proceeds', 'net-proceeds'],
    text: "What comes out before anyone in the waterfall is paid: typically a distributor's fee, a sales agent's commission, delivery and marketing costs, and guild payments such as residuals. ProfitShare models all of it as one percentage, Fees and expenses off the top on the Pitch tab, not item by item.",
  },
  {
    id: 'net-proceeds',
    term: 'Net proceeds',
    also: ['net to the film', 'revenue'],
    find: ['revenue scenarios', "producer's net"],
    group: 'backend',
    see: ['gross-proceeds', 'net-profits'],
    text: 'Gross proceeds less the off-the-top deductions. ProfitShare calls it Net to the film. The three Revenue scenarios on the Deal tab, and every "At revenue of" figure on Points & waterfall, are net figures: the app takes no fees out of them. They are your numbers, not a forecast.',
  },
  {
    id: 'recoupment',
    term: 'Recoupment',
    also: ['recoup'],
    find: ['investor return'],
    group: 'backend',
    see: ['investors-put-in', 'premium'],
    text: 'Investors getting back the money they put in, with any premium, out of what the film earns.',
  },
  {
    id: 'recoup-first',
    term: 'Recoup first',
    group: 'backend',
    see: ['off-the-gross', 'recoupment'],
    text: 'One of the two waterfall models. After deferred pay, investors take everything until they have recouped. Above that, the pool takes its share after recoup and investors keep the rest. Simpler to explain, but nobody in the pool is paid until recoupment.',
  },
  {
    id: 'off-the-gross',
    term: 'Off the gross',
    find: ['first dollar', 'Sing Sing', 'gross participation'],
    group: 'backend',
    see: ['recoup-first', 'pool'],
    text: 'The other waterfall model. After deferred pay, the pool takes its share of every dollar from the first one, and investors recoup out of what is left. Once they have, the split changes to the pool share after recoup. ProfitShare applies this to net to the film, not to true gross proceeds.',
  },
  {
    id: 'pool',
    term: 'Cast and crew pool',
    also: ['the pool'],
    find: ['cast & crew pool', 'participant pool'],
    group: 'backend',
    see: ['points', 'off-the-gross'],
    text: "The part of the film's earnings that goes to everyone holding points. Two percentages on the Deal tab size it: Pool share of gross, in the off the gross model, and Pool share after recoup. It is divided by points.",
  },
  {
    id: 'points-tier',
    term: 'Points tier',
    find: ['multiplier', 'bonus', 'fixed points', 'points schedule'],
    group: 'backend',
    see: ['points', 'sag-tier'],
    text: 'A group on the points schedule, such as department head or lead, with a multiplier on days worked. A bonus multiplies one person\'s points again, and "fix" swaps the sum for a set block of points. Not to be confused with a SAG-AFTRA tier.',
  },
  {
    id: 'investor-multiple',
    term: 'Investor multiple',
    find: ['return multiple', 'ROI'],
    group: 'backend',
    see: ['investors-put-in'],
    text: 'What investors receive at a revenue figure, divided by what they put in. 1.00× means they have their money back and nothing more.',
  },
  {
    id: 'net-profits',
    term: 'Net profits',
    find: ['profits', 'net profit participation'],
    group: 'backend',
    see: ['net-proceeds', 'recoupment'],
    text: 'What is left of net proceeds once deferred pay is paid and investors have recouped. Agreements define it at length and not all alike. ProfitShare has no line with this name: it is the money divided by Pool share after recoup, with the rest going to investors.',
  },
  {
    id: 'pari-passu',
    term: 'Pari passu',
    group: 'backend',
    see: ['pro-rata'],
    text: 'Latin for "on equal footing": parties paid at the same time and the same rank, not one after the other. ProfitShare treats all investors as one group and does not rank them against each other.',
  },
  {
    id: 'pro-rata',
    term: 'Pro rata',
    group: 'backend',
    see: ['pari-passu', 'points'],
    text: "In proportion. Investors usually share recoupment pro rata to what each put in; ProfitShare does not divide the investors' side between people. It does divide the pool pro rata, by points.",
  },
  {
    id: 'incentives',
    term: 'Incentives and tax credits',
    find: ['tax credit', 'rebate', 'California film tax credit', 'fee waivers'],
    group: 'backend',
    see: ['bridge-loan', 'investors-put-in'],
    text: 'Money a government gives back for spending where it wants you to spend. On the Incentives tab they are switches: they do not change what the film spends, they reduce what investors put in and so what investors recoup. ProfitShare does not count a credit as revenue in the waterfall.',
  },
  {
    id: 'bridge-loan',
    term: 'Bridge loan',
    find: ['bridge it', 'loan cost', 'lender', 'pledged tax credit'],
    group: 'backend',
    see: ['incentives'],
    text: "A loan against a tax credit you have been promised but not yet paid, so the money is there for the shoot; the lender is repaid when the credit arrives. ProfitShare takes the loan's cost, a percentage you set, off what the credit is worth, and tells you when a credit you are counting arrives after delivery with no bridge.",
  },
  {
    id: 'grants',
    term: 'Grants and fiscal sponsorship',
    find: ['grant', 'donations', 'fiscal sponsor', "sponsor's fee", 'non-recoupable'],
    group: 'backend',
    see: ['investors-put-in'],
    text: "Money that never has to be paid back. A fiscal sponsor is a non-profit that takes donations for your film and keeps a fee. ProfitShare takes the sponsor's fee off, then takes what is left off the amount investors put in.",
  },

  // ---- The schedule ----
  {
    id: 'stripboard',
    term: 'Stripboard',
    also: ['the board'],
    find: ['shooting schedule'],
    group: 'schedule',
    see: ['strip', 'day-break'],
    text: 'The schedule as a column of strips, one per scene, in shooting order. Drag the strips to reorder them.',
  },
  {
    id: 'strip',
    term: 'Strip',
    group: 'schedule',
    see: ['stripboard', 'eighths'],
    text: 'One scene on the stripboard: its number, where it is set, day or night, its length and who is in it. A scene can be split into two strips to shoot across two days.',
  },
  {
    id: 'day-break',
    term: 'Day break',
    find: ['daybreak', 'day bar'],
    group: 'schedule',
    see: ['stripboard'],
    text: 'The bar that ends one shoot day and starts the next. Place them by hand, at a pages-per-day target, or fit them to a number of days.',
  },
  {
    id: 'eighths',
    term: 'Eighths',
    find: ['page count', 'pages', '1/8'],
    group: 'schedule',
    text: 'How script pages are measured: each page is divided into eight, so a scene runs 2 3/8 pages, not 2.4. ProfitShare reads them off the script and adds them up for each day.',
  },
  {
    id: 'call-sheet',
    term: 'Call sheet',
    group: 'schedule',
    see: ['stripboard'],
    text: 'The page everyone gets the night before: where to be, when, which scenes, who is called. ProfitShare draws one for each shoot day from the board, the calendar and the points schedule, and you edit it in place.',
  },

  // ---- In agreements, not in ProfitShare ----
  {
    id: 'collection-account',
    term: 'Collection account',
    also: ['CAM'],
    find: ['collection account manager', 'collection agent'],
    group: 'elsewhere',
    text: "A bank account run by a neutral third party that takes in the film's income and pays everyone in the order the agreements say. ProfitShare does not model one, or its fee.",
  },
  {
    id: 'reserves',
    term: 'Reserves',
    find: ['reserve'],
    group: 'elsewhere',
    text: 'Money the production company holds back from a payout to cover bills it expects later. ProfitShare pays out every dollar of each revenue figure.',
  },
  {
    id: 'audit-rights',
    term: 'Audit rights',
    find: ['audit'],
    group: 'elsewhere',
    text: "An investor's or participant's right to inspect the books behind a statement. There is nothing to compute, so there is nothing in the app; it belongs in your agreements.",
  },
  {
    id: 'cross-collateralisation',
    term: 'Cross-collateralisation',
    also: ['cross-collateralization'],
    find: ['cross collateralisation', 'slate'],
    group: 'elsewhere',
    text: "Letting one film's losses be recovered from another film's income. ProfitShare works one film at a time.",
  },
];

/** The address of a term inside the page: `#glossary-points`. */
export const glossaryAnchor = (id: string) => `glossary-${id}`;

/** The term id a page address points at, or null when the address is not a glossary one. A bare `#glossary` is the
 *  section itself and gives ''. */
export function glossaryIdFromHash(hash: string): string | null {
  const h = hash.replace(/^#/, '');
  if (h === 'glossary') return '';
  if (!h.startsWith('glossary-')) return null;
  const id = h.slice('glossary-'.length);
  return GLOSSARY.some(t => t.id === id) ? id : ''; // an address for a term that is gone still opens the glossary
}

// Typed words are matched loosely: case, accents, hyphens and the & sign should not be why a search finds nothing.
const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim();

/** The terms a typed search keeps, in the glossary's own order. Every typed word has to appear somewhere in the
 *  term, its other names, its search words or its definition; a match in the name or other names comes before one found only in the
 *  definition, so typing "points" puts Points first. An empty search keeps everything. */
export function searchGlossary(query: string, terms: GlossaryTerm[] = GLOSSARY): GlossaryTerm[] {
  const words = fold(query).split(' ').filter(Boolean);
  if (!words.length) return terms;
  const named: GlossaryTerm[] = [],
    mentioned: GlossaryTerm[] = [];
  for (const t of terms) {
    const names = fold([t.term, ...(t.also ?? []), ...(t.find ?? [])].join(' '));
    const all = `${names} ${fold(t.text)}`;
    if (words.every(w => names.includes(w))) named.push(t);
    else if (words.every(w => all.includes(w))) mentioned.push(t);
  }
  return [...named, ...mentioned];
}
