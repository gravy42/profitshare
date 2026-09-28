// Builds the fictional sample project that ships with ProfitShare, plus the importer test fixtures made from it.
// Everything here is invented: the film, the people, the numbers. Run: node tools/make-sample.mjs
import { writeFileSync, readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';

const FILM = 'SALT FLAT';
const SHOOT_DAYS = 12;
const HRS = 14;            // 12-hour day: 8 straight + 4 at 1.5x = 14 paid hours
const PAYROLL = ['FICA1', 'FICA2', 'FUI', 'SUI (CA)', 'WC (CA)', 'PAYROLL FEE'];
const SAG = ['SAG AFTRA', 'FICA1', 'FICA2', 'FUI', 'SUI (CA)', 'WC (CA)', 'PAYROLL FEE'];
const MLB_DAY = 449;

// Chart of accounts: reuse the standard one already in the repo (numbers and names only, no money).
const coa = JSON.parse(readFileSync(new URL('../src/data/chart-of-accounts.json', import.meta.url)));

// ---------- cast & board ----------
const CAST = ['LENA', 'JUNE', 'DEL', 'WALT', 'THE MECHANIC', 'RANGER PRICE', 'KID', 'WAITRESS'];
// eighths are given as a small base value and tripled: 26 scenes at ~70 pages, roughly 6 pages a day over 12 days
const S = (number, ie, set, tod, eighths, cast, synopsis, extra = {}) => ({ number: String(number), ie, set, tod, eighths: eighths * 3, cast, synopsis, ...extra });
const SCENES = [
  S(1, 'EXT', 'DESERT HIGHWAY', 'DAWN', 6, ['LENA', 'JUNE'], 'Two sisters push a dead station wagon onto the shoulder.', { Vehicles: ['station wagon'] }),
  S(2, 'INT', 'STATION WAGON', 'DAWN', 4, ['LENA', 'JUNE'], 'June finds the letter in the glovebox. Lena pretends not to see.', { Props: ['the letter'] }),
  S(3, 'EXT', 'GAS STATION', 'DAY', 9, ['LENA', 'JUNE', 'THE MECHANIC'], 'The Mechanic quotes a price neither of them has.', { Vehicles: ['station wagon', 'tow truck'] }),
  S(4, 'INT', 'GAS STATION DINER', 'DAY', 12, ['LENA', 'JUNE', 'WAITRESS'], 'Pie, coffee, and the first real fight.', { Props: ['pie', 'coffee pot'] }),
  S(5, 'EXT', 'GAS STATION', 'DUSK', 3, ['JUNE', 'KID'], 'A kid on a bike sells June a map for a dollar.', { Props: ['folded map'], Vehicles: ['bmx bike'] }),
  S(6, 'INT', 'MOTEL ROOM', 'NIGHT', 10, ['LENA', 'JUNE'], 'Two beds, one lamp. Lena reads the letter out loud.'),
  S(7, 'EXT', 'MOTEL POOL', 'NIGHT', 5, ['LENA'], 'Lena floats on her back in the empty pool.'),
  S(8, 'INT', 'MOTEL OFFICE', 'MORNING', 4, ['JUNE', 'WALT'], 'Walt, the owner, offers a trade: a car for a week of work.'),
  S(9, 'EXT', 'MOTEL PARKING LOT', 'MORNING', 6, ['LENA', 'JUNE', 'WALT'], 'Lena says no. June says yes.', { Vehicles: ['pickup'] }),
  S(10, 'INT', 'MOTEL LAUNDRY', 'DAY', 7, ['JUNE', 'WALT'], 'Folding sheets, Walt tells the story of the flats.'),
  S(11, 'EXT', 'DESERT ROAD', 'DAY', 5, ['LENA'], 'Lena walks. A truck slows, then keeps going.', { Vehicles: ['semi (picture)'] }),
  S(12, 'EXT', 'RANGER STATION', 'DAY', 8, ['LENA', 'RANGER PRICE'], 'Ranger Price gives Lena water and a warning.'),
  S(13, 'INT', 'RANGER STATION', 'DAY', 6, ['LENA', 'RANGER PRICE'], 'A map on the wall with a red pin where the letter says to go.', { Props: ['wall map', 'red pin'] }),
  S(14, 'INT', 'MOTEL ROOM', 'NIGHT', 8, ['JUNE'], 'June alone, calling a number that rings out.', { Props: ['flip phone'] }),
  S(15, 'EXT', 'MOTEL POOL', 'DAWN', 4, ['JUNE', 'WALT'], 'Walt drains the pool. June helps without being asked.'),
  S(16, 'EXT', 'SALT FLATS', 'DAY', 14, ['LENA'], 'White to the horizon. Lena finds the marker.', { Props: ['stone marker'] }),
  S(17, 'EXT', 'SALT FLATS', 'DUSK', 9, ['LENA', 'RANGER PRICE'], 'Price finds her before the dark does.', { Vehicles: ['ranger truck'] }),
  S(18, 'INT', 'RANGER TRUCK', 'NIGHT', 6, ['LENA', 'RANGER PRICE'], 'Driving back. Price admits she knew their mother.'),
  S(19, 'INT', 'GAS STATION DINER', 'NIGHT', 10, ['JUNE', 'WAITRESS', 'THE MECHANIC'], 'June learns the car was never broken.', { Props: ['pie'] }),
  S(20, 'EXT', 'GAS STATION', 'NIGHT', 5, ['JUNE', 'THE MECHANIC'], 'The Mechanic hands over the keys and the real bill: nothing.', { Vehicles: ['station wagon'], Props: ['car keys'] }),
  S(21, 'EXT', 'MOTEL PARKING LOT', 'NIGHT', 7, ['LENA', 'JUNE', 'RANGER PRICE'], 'The sisters see each other across the lot.'),
  S(22, 'INT', 'MOTEL ROOM', 'NIGHT', 12, ['LENA', 'JUNE'], 'The whole letter, finally, both of them.'),
  S(23, 'EXT', 'MOTEL POOL', 'MORNING', 6, ['LENA', 'JUNE', 'WALT', 'KID'], 'The pool fills. The kid cannonballs.', { Vehicles: ['bmx bike'] }),
  S(24, 'INT', 'STATION WAGON', 'DAY', 5, ['LENA', 'JUNE'], 'Driving. The map goes out the window.', { Props: ['folded map'], Vehicles: ['station wagon'] }),
  S(25, 'EXT', 'SALT FLATS', 'DAY', 11, ['LENA', 'JUNE'], 'They reach the marker together and leave the letter under it.', { Props: ['the letter', 'stone marker'] }),
  S(26, 'EXT', 'DESERT HIGHWAY', 'DUSK', 4, ['LENA', 'JUNE'], 'The wagon, running, small against the sky.', { Vehicles: ['station wagon'] }),
];
// Shooting order: grouped by location, not script order. No day breaks; the app places those.
const ORDER = [3, 5, 20, 4, 19, 1, 26, 11, 2, 24, 8, 10, 9, 21, 6, 22, 14, 7, 15, 23, 12, 13, 18, 16, 25, 17];

const castList = CAST.map((name, i) => ({ id: i + 1, name }));
const scenes = SCENES.map(s => ({
  id: `sc${s.number}`, number: s.number, ie: s.ie, set: s.set, tod: s.tod, pages: '', eighths: s.eighths, synopsis: s.synopsis,
  location: /SALT|RANGER|DESERT/.test(s.set) ? 'Wendover, UT' : 'Motel & gas station, Wendover, UT', scriptDay: '',
  cast: s.cast.map(n => ({ id: castList.find(c => c.name === n).id, name: n })),
  elements: Object.fromEntries(Object.entries(s).filter(([k]) => ['Props', 'Vehicles'].includes(k))),
}));
// pages as text: running eighths → "1 4/8" style page counts are cosmetic; keep the eighths and a simple label
for (const s of scenes) s.pages = `${Math.floor(s.eighths / 8) || ''}${s.eighths % 8 ? ` ${s.eighths % 8}/8` : ''}`.trim() || '0';
const board = { castList, scenes, strips: ORDER.map(n => ({ type: 'scene', sceneId: `sc${n}` })) };

// ---------- budget ----------
const lines = [];
let n = 0;
const L = (accountId, description, amount = 0, unit = '-', rate = 0, multiplier = 1, fringes = [], tags = []) =>
  lines.push({ id: `L${++n}`, accountId, description, amount, unit, rate, multiplier, fringes, tags, payType: 'cash', notes: '' });
const allow = (acct, desc, amt) => L(acct, desc, 1, 'ALLOW', amt);
const crew = (acct, name, hourly, prepDays, shoot = SHOOT_DAYS, wrapDays = 0) => {
  L(acct, `#1: ${name}`);
  if (prepDays) L(acct, 'Prep', prepDays, 'DAY', hourly, HRS, PAYROLL, ['W BTL']);
  L(acct, 'Shoot', shoot, 'DAY', hourly, HRS, PAYROLL, ['W BTL']);
  if (wrapDays) L(acct, 'Wrap', wrapDays, 'DAY', hourly, HRS, PAYROLL, ['W BTL']);
};
const castDays = { LENA: 12, JUNE: 12, DEL: 0, WALT: 6, 'THE MECHANIC': 3, 'RANGER PRICE': 5, KID: 2, WAITRESS: 2 };

// ATL
L('1102', 'Script purchase', 1, 'ALLOW', 25000);
L('1103', 'Title & copyright report', 1, 'ALLOW', 900);
L('1201', 'Fee', 1, 'ALLOW', 40000, 1, [], ['ATL']);
L('1201', 'Fee', 1, 'ALLOW', 25000, 1, [], ['ATL']);
L('1301', '#1: Writer / Director');
L('1301', 'Prep', 8, 'WEEK', 1500, 1, PAYROLL, ['ATL']);
L('1301', 'Shoot', 3, 'WEEK', 1500, 1, PAYROLL, ['ATL']);
L('1301', 'Post', 10, 'WEEK', 750, 1, PAYROLL, ['ATL']);
L('1401', 'CAST #1: LENA');
L('1401', 'Shoot', castDays.LENA, 'DAY', MLB_DAY, 1, SAG, ['SAG']);
L('1401', 'STAR ALLOWANCE', 1, 'ALLOW', 15000);
L('1401', 'Agent fee (10%)', 1, 'ALLOW', castDays.LENA * MLB_DAY, 0.1);
L('1401', 'CAST #2: JUNE');
L('1401', 'Shoot', castDays.JUNE, 'DAY', MLB_DAY, 1, SAG, ['SAG']);
L('1401', 'Agent fee (10%)', 1, 'ALLOW', castDays.JUNE * MLB_DAY, 0.1);
for (const name of ['WALT', 'RANGER PRICE', 'THE MECHANIC']) {
  L('1402', `CAST #${castList.find(c => c.name === name).id}: ${name}`);
  L('1402', 'Shoot', castDays[name], 'DAY', MLB_DAY, 1, SAG, ['SAG']);
}
for (const name of ['KID', 'WAITRESS']) {
  L('1403', `CAST #${castList.find(c => c.name === name).id}: ${name}`);
  L('1403', 'Shoot', castDays[name], 'DAY', MLB_DAY, 1, SAG, ['SAG']);
}
L('1404', 'Casting director', 1, 'ALLOW', 6000);
L('1601', 'Airfare (2 cast)', 4, 'ITEM', 320);
L('1602', 'Hotel (cast, 14 nights)', 28, 'DAY', 95);
L('1604', 'Per diem (cast)', 28, 'DAY', 60);

// Production
L('2002', 'Background (non-union)', 30, 'DAY', 150, 1, PAYROLL);
crew('2101', 'Dana Okafor (Line producer / UPM)', 35.71, 20, SHOOT_DAYS, 10);
crew('2102', 'Marcus Bell (1st AD)', 33.93, 10);
crew('2103', 'Priya Nair (2nd AD)', 26.79, 3);
crew('2109', 'Sam Reyes (Production coordinator)', 22.32, 15, SHOOT_DAYS, 5);
crew('2107', 'Script supervisor', 26.79, 2);
L('2111', 'KEY SET PA'); L('2111', 'Shoot', SHOOT_DAYS, 'DAY', 17.86, HRS, PAYROLL, ['W BTL']);
L('2111', 'SET PA'); L('2111', 'Shoot', SHOOT_DAYS, 'DAY', 17.86, HRS, PAYROLL, ['W BTL']);
L('2111', 'SET PA'); L('2111', 'Shoot', SHOOT_DAYS, 'DAY', 17.86, HRS, PAYROLL, ['W BTL']);
crew('2201', 'Theo Lindqvist (Production designer)', 32.14, 10, SHOOT_DAYS, 2);
crew('2202', 'Art director', 26.79, 5, SHOOT_DAYS, 2);
allow('2210', 'Art supplies & materials', 4500);
crew('2301', 'Set decorator', 26.79, 5, SHOOT_DAYS, 1);
allow('2310', 'Set dressing purchases', 6000);
allow('2311', 'Set dressing rentals', 3500);
crew('2401', 'Property master', 26.79, 5, SHOOT_DAYS, 1);
allow('2410', 'Prop purchases', 2500);
allow('2411', 'Prop rentals', 1800);
L('2408', 'Picture vehicles (station wagon, pickup, tow truck)', 1, 'ALLOW', 7500);
crew('2601', 'Ines Calderón (Director of photography)', 35.71, 8);
crew('2603', '1st AC', 30.36, 1);
crew('2604', '2nd AC', 26.79, 1);
L('2611', 'Camera package (2 bodies)', 3, 'WEEK', 6500);
L('2611', 'Lens set', 3, 'WEEK', 2800);
allow('2610', 'Camera expendables', 1200);
crew('2701', 'Gaffer', 30.36, 2);
crew('2702', 'Best boy electric', 26.79, 1);
L('2711', 'Lighting package', 3, 'WEEK', 4200);
L('2706', 'Generator (tow plant)', 12, 'DAY', 350);
L('2707', 'Generator fuel', 12, 'DAY', 100);
crew('2801', 'Key grip', 30.36, 2);
crew('2802', 'Best boy grip', 26.79, 1);
L('2811', 'Grip package + truck', 3, 'WEEK', 3800);
allow('2806', 'Set medic (12 days)', 12 * 350);
allow('2808', 'Craft service', 3600);
crew('2901', 'Production sound mixer', 33.93, 1);
crew('2902', 'Boom operator', 26.79, 0);
L('2911', 'Sound package', 3, 'WEEK', 1500);
crew('3001', 'Costume designer', 30.36, 8, SHOOT_DAYS, 2);
allow('3010', 'Wardrobe purchases', 5000);
allow('3011', 'Wardrobe rentals', 1500);
crew('3101', 'Key makeup & hair', 30.36, 1);
allow('3110', 'Makeup & hair supplies', 1200);
L('3306', 'Cube truck + cargo van', 3, 'WEEK', 2400);
L('3307', 'Fuel', 12, 'DAY', 180);
crew('3401', 'Location manager', 26.79, 15, SHOOT_DAYS, 2);
L('3406', 'Motel (all rooms, 14 nights)', 1, 'ALLOW', 18000);
L('3406', 'Gas station & diner (6 days)', 6, 'DAY', 1500);
L('3407', 'Salt flats BLM permit + ranger station', 1, 'ALLOW', 3200);
L('3416', 'Catered meals (38 heads x 12 days)', 456, 'ITEM', 22);
allow('3505', 'PPE & safety supplies', 800);
L('3602', 'Crew hotel (28 rooms, 14 nights)', 392, 'DAY', 79);
L('3604', 'Crew per diem', 38 * 14, 'DAY', 45);
allow('3603', 'Crew travel (LA to Wendover, vans)', 4200);

// Post
L('4001', '#1: Editor'); L('4001', 'Edit', 10, 'WEEK', 1800, 1, PAYROLL);
L('4002', 'Assistant editor', 4, 'WEEK', 1100, 1, PAYROLL);
allow('4011', 'Edit suite / storage', 3500);
allow('4101', 'Composer (package)', 12000);
allow('4105', 'Licensed songs (2)', 8000);
allow('4203', 'VFX cleanup (30 shots)', 9000);
allow('4303', 'Sound design & mix', 22000);
allow('4311', 'ADR stage (2 days)', 2400);
allow('4402', 'Color grade', 12000);
allow('4405', 'Main & end titles', 1500);
allow('4406', 'Deliverables', 3000);

// Other
allow('5002', 'Stills photographer (4 days)', 2000);
allow('5003', 'Festival submissions', 4000);
allow('5101', 'Production package insurance', 14000);
allow('5102', 'E&O insurance', 2500);
allow('5201', 'Legal (SAG signatory, contracts)', 9500);
allow('5203', 'Accounting & payroll setup', 4500);
allow('5207', 'Office, software, phones', 2200);

// ---------- money math (same as src/engine/budget.ts) ----------
const FR = { FICA1: [0.062, null], FICA2: [0.0145, null], FUI: [0.006, 7000], 'SUI (CA)': [0.062, 7000], 'WC (CA)': [0.0448, null], 'PAYROLL FEE': [0.0175, null], 'SAG AFTRA': [0.21, null] };
const r2 = x => Math.round(x * 100) / 100;
const sub = l => r2(l.amount * l.rate * l.multiplier);
const fr = l => { const w = sub(l); if (w <= 0) return 0; return r2(l.fringes.reduce((t, id) => { const [rate, cap] = FR[id]; return t + (cap ? Math.min(w, cap) : w) * rate; }, 0)); };
const accounts = coa.accounts.filter(a => lines.some(l => l.accountId === a.number));
const categories = coa.categories.filter(c => accounts.some(a => a.categoryNumber === c.number));
for (const l of lines) if (!accounts.some(a => a.number === l.accountId)) throw new Error(`unknown account ${l.accountId}`);
const subtotal = r2(lines.reduce((t, l) => t + sub(l) + fr(l), 0));
const contingency = r2(subtotal * 0.1);
const grand = r2(subtotal + contingency);
console.log(`${FILM}: ${lines.length} lines, subtotal ${subtotal}, contingency ${contingency}, grand total ${grand}`);

const budget = { name: FILM, version: 'Draft 3', currency: 'USD', shootDays: SHOOT_DAYS, contingencyPct: 10, categories, accounts, lines, totals: { subtotal, contingency, grandTotal: grand } };
writeFileSync(new URL('../src/data/sample-budget.json', import.meta.url), JSON.stringify(budget, null, 1));
writeFileSync(new URL('../src/data/sample-board.json', import.meta.url), JSON.stringify(board, null, 1));

// ---------- fixture 1: the same budget in Shamel Studio's export layout ----------
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Project Name', FILM], ['Budget Name', 'Draft 3'], ['Location Shoot Days', SHOOT_DAYS], ['Currency', 'USD']]), 'Budget Metadata');
const catTotal = c => r2(lines.filter(l => accounts.find(a => a.number === l.accountId)?.categoryNumber === c.number).reduce((t, l) => t + sub(l) + fr(l), 0));
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
  ['Account#', 'Description', 'Subtotal', 'Fringes', 'Total'],
  ...categories.map(c => [c.number, c.name, '', '', catTotal(c)]),
  ['', 'Subtotal', '', '', subtotal], ['', 'Contingency (10%)', '', '', contingency], ['', 'Grand Total', '', '', grand],
]), 'TopSheet');
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Account#', 'Description'], ...accounts.map(a => [a.number, a.name])]), 'Accounts');
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
  ['Account#', 'Description', 'Agg%', 'Fringes', 'Tags', 'Amount', 'Units', 'Rate', 'Currency', 'Multiplier', 'Subtotal', 'Fringes($)', 'Total', 'Actual', 'Variance', 'Notes'],
  ...lines.map(l => [l.accountId, l.description, '', l.fringes.join(', '), l.tags.join(', '), l.amount, l.unit, l.rate, 'USD', l.multiplier, sub(l), fr(l), r2(sub(l) + fr(l)), '', '', '']),
]), 'Details');
XLSX.writeFile(wb, new URL('../tools/fixtures/Budget_SaltFlat_Draft3.xlsx', import.meta.url).pathname);

// ---------- fixture 2: the board as a Movie Magic .sex file (the layout src/engine/importers/sex.ts reads) ----------
const CATS = ['Synopsis', 'Cast Members', 'Props', 'Vehicles', 'Location', 'Script Day', 'Comments'];
const bytes = [];
const push = (...b) => bytes.push(...b);
const str = s => { for (const ch of s) push(ch.charCodeAt(0) & 0xff); };
const u16 = v => push(v & 0xff, (v >> 8) & 0xff);
str('SSI*'); push(0, 0x23, 0, 0, 0, 1, 0, 0);            // header, 12 bytes total before the category list
for (const c of CATS) { str(c); push(0); }
const rec = (type, payload) => { push(0x23, 0, 0, 0); u16(payload.length + 2); u16(type); push(...payload); };
const enc = s => Array.from(s, ch => ch.charCodeAt(0) & 0xff);
const scIdx = new Map(scenes.map((s, i) => [s.id, i + 1]));
for (const st of board.strips) {                             // type-1 records in board order
  const s = scenes.find(x => x.id === st.sceneId);
  rec(1, [scIdx.get(s.id), ...enc(`${s.pages}\t${s.number}\t${s.ie} ${s.set}-${s.tod}`), 0]);
}
for (const s of scenes) {
  const idx = scIdx.get(s.id);
  rec(3, [idx & 0xff, idx >> 8, 0, 0, s.eighths & 0xff, s.eighths >> 8]);
  const el = (cat, text) => rec(2, [idx & 0xff, idx >> 8, CATS.indexOf(cat), ...enc(text), 0]);
  el('Synopsis', s.synopsis);
  for (const c of s.cast) el('Cast Members', c.name);
  for (const [cat, items] of Object.entries(s.elements)) for (const it of items) el(cat, it);
  el('Location', s.location);
}
writeFileSync(new URL('../tools/fixtures/SaltFlat_Board.sex', import.meta.url), Buffer.from(bytes));
console.log('wrote sample-budget.json, sample-board.json, Budget_SaltFlat_Draft3.xlsx, SaltFlat_Board.sex');
