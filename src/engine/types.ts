// Core data model. Everything the app knows about a film lives in one Project
// object, saved as a single .json file. Keep this file dependency-free.

export type Section = 'ATL' | 'PRODUCTION' | 'POST' | 'OTHER';

/** How a line item gets paid.
 *  cash     – paid from the production account. Counts toward the budget and SAG total production cost.
 *  deferred – a fixed IOU paid from first proceeds. Not cash, but SAG's low-budget agreements
 *             count deferred compensation inside "total production cost", so it still counts for tier.
 *  points   – contingent profit participation with no fixed value. Not a budget line at all;
 *             it appears only in the points schedule. */
export type PayType = 'cash' | 'deferred' | 'points';

export interface FringeDef {
  id: string;
  name: string;
  rate: number;      // 0.062 = 6.2 %
  cap?: number | null; // wage base the rate applies to, per line (e.g. FUI/SUI $7,000). null = uncapped
}

export interface Category { number: string; name: string; section: Section }
export interface Account  { number: string; name: string; categoryNumber: string }

export interface LineItem {
  id: string;
  accountId: string;        // Account.number
  description: string;
  amount: number;           // units (days, weeks, allowances...)
  unit: string;             // DAY | WEEK | ALLOW | ITEM | MONTH | HOUR | '-'
  rate: number;
  multiplier: number;       // hours per day for hourly crew (14 = 12-hr day at 8+4x1.5), 0.1 for agent fees, etc.
  fringes: string[];        // FringeDef ids applied to this line
  tags: string[];
  payType: PayType;
  participantId?: string;   // links this line's days to a person in the points schedule
  notes?: string;
}

/** A person (or role) who shares in the back end. */
export interface Participant {
  id: string;
  name: string;
  role: string;             // "Lead", "DP", "Production Assistant"...
  group: 'cast' | 'crew' | 'producer' | 'other';
  tierId: string;           // PointsTier.id
  days: number;             // days worked (drives points). Can be synced from the board or budget lines.
  bonusMultiplier: number;  // per-person nudge on top of the tier (1 = none)
  castId?: number;          // cast number on the board, for syncing days from the DOOD
}

export interface PointsTier { id: string; name: string; multiplier: number }

export type WaterfallModel = 'recoup-first' | 'off-the-gross';

export interface Waterfall {
  model: WaterfallModel;
  recoupPct: number;      // investors get this % of budget back before the pool (110 = 110 %)
  nonRecoupable?: number; // grants, fiscal-sponsorship donations, tax credits: money that never has to be paid back
  poolPct: number;        // share of post-recoup profits that goes to the pool (50 = 50/50)
  grossSharePct: number;  // off-the-gross only: pool's share of dollar one until investors recoup
  scenarios: number[];    // revenue levels shown in the tables
}

export type SagTierId = 'ULB' | 'MLB' | 'LBA' | 'BASIC';

export interface SagTier {
  id: SagTierId;
  name: string;
  dayRate: number;
  weeklyRate: number | null;
  cap: number | null;        // total production cost ceiling, null = no ceiling
  dicCap: number | null;     // ceiling with the Diversity in Casting incentive
  phRate: number;            // pension & health
  effective: string;
}

export interface SagSettings {
  targetTier: SagTierId;     // which agreement the cast is costed at
  dic: boolean;              // Diversity in Casting incentive qualified
  includeContingency: boolean; // count contingency inside total production cost (conservative default: yes)
}

// ---------- schedule ----------

export interface SceneCast { id?: number | null; name: string }

export interface Scene {
  id: string;
  number: string;
  ie: 'INT' | 'EXT' | 'I/E';
  set: string;
  tod: string;              // MORNING, NIGHT, ...
  pages: string;            // script page range as text
  eighths: number;          // length in eighths of a page
  synopsis: string;
  location: string;
  scriptDay: string;
  cast: SceneCast[];
  elements: Record<string, string[]>; // breakdown category -> items
}

export type Strip =
  | { type: 'scene'; sceneId: string }
  | { type: 'daybreak'; id: string; label?: string; date?: string }
  | { type: 'banner'; id: string; text: string };

export interface CastMember { id: number; name: string }

export interface Board {
  castList: CastMember[];
  scenes: Scene[];
  strips: Strip[];
  targetEighthsPerDay: number; // used by auto day-breaks
}

// ---------- the whole project ----------

export interface Project {
  schemaVersion: 1;
  name: string;
  version: string;
  currency: string;
  shootDays: number;
  dayHours?: 10 | 12;       // length of a shooting day for hourly crew (default 12: 8 straight + 4 at 1.5x = 14 paid hours)
  contingencyPct: number;
  categories: Category[];
  accounts: Account[];
  fringes: FringeDef[];
  lines: LineItem[];
  participants: Participant[];
  tiers: PointsTier[];
  waterfall: Waterfall;
  sag: SagSettings;
  board: Board;
  notes?: string;
}
