export const money = (n: number, digits = 0) =>
  (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;
export const num = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
