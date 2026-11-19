import type { FringeDef } from './types';

/** California payroll fringes for 2026, fitted to Shamel Studio's own math. Every new budget starts with them, so
 *  they live here, apart from the importers: the page that opens first needs this list and not the code that reads
 *  spreadsheets, which is only loaded when a file is brought in. */
export const CA_FRINGES_2026: FringeDef[] = [
  { id: 'FICA1', name: 'FICA1 (Social Security)', rate: 0.062, cap: null },
  { id: 'FICA2', name: 'FICA2 (Medicare)', rate: 0.0145, cap: null },
  { id: 'FUI', name: 'FUI', rate: 0.006, cap: 7000 },
  { id: 'SUI (CA)', name: 'SUI (CA)', rate: 0.062, cap: 7000 },
  { id: 'WC (CA)', name: 'Workers Comp (CA)', rate: 0.0448, cap: null },
  { id: 'PAYROLL FEE', name: 'Payroll service fee', rate: 0.0175, cap: null },
  { id: 'SAG AFTRA', name: 'SAG-AFTRA P&H (principals)', rate: 0.21, cap: null },
  { id: 'SAG AFTRA BG', name: 'SAG-AFTRA P&H (background)', rate: 0.2075, cap: null },
  { id: 'PAYROLL FEE SAG BG', name: 'Payroll fee (SAG background)', rate: 0.0175, cap: null },
];
