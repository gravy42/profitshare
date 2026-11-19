import { useState } from 'react';
import type { Project } from '../engine/types';
import { downloadBlob } from './deckPdf';

type Kind = 'xlsx' | 'csv' | 'pdf';
const KINDS: { kind: Kind; label: string; name: string; mime: string }[] = [
  { kind: 'xlsx', label: 'Excel', name: 'Export the budget as an Excel workbook (.xlsx)', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  { kind: 'csv', label: 'CSV', name: 'Export the budget lines as a CSV file (.csv)', mime: 'text/csv;charset=utf-8' },
  { kind: 'pdf', label: 'PDF', name: 'Export the top sheet and full budget as a PDF file (.pdf)', mime: 'application/pdf' },
];

/** What each export is for, in a line under the top sheet's own help. */
export const BUDGET_EXPORT_HELP = 'Export sends the budget to someone who does not use ProfitShare. Excel is the whole budget as a workbook: the top sheet, every line, the points schedule and the deal terms. CSV is the budget lines alone, for other budgeting software (ProfitShare can read it back in). PDF is the top sheet and the full budget, ready to read or print.';

/** Export the budget as it stands on the Top sheet tab: three buttons beside the print buttons. The work is done in
 *  the browser and handed over as a download; nothing is sent anywhere. The exporters (and the PDF library they need)
 *  are loaded only when a button is pressed. */
export function BudgetExport({ project, onNote }: { project: Project; onNote: (note: string) => void }) {
  const [busy, setBusy] = useState<Kind | null>(null);
  const run = async (kind: Kind, mime: string) => {
    if (busy) return;
    setBusy(kind); onNote('');
    try {
      const x = await import('../engine/exporters/budgetExport');
      const date = new Date();
      const data = kind === 'xlsx' ? x.budgetXlsx(project, { date }) : kind === 'pdf' ? await x.budgetPdf(project, { date }) : x.budgetCsv(project);
      const name = x.budgetFileName(project, kind);
      // a copy of exactly the file's bytes: a Blob made from a view keeps the whole buffer under it
      const part = typeof data === 'string' ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
      downloadBlob(new Blob([part], { type: mime }), name);
      onNote(`Saved ${name} to your downloads.`);
    } catch (e) {
      console.error('budget export failed', e);
      onNote('The export could not be made. Nothing in the project has changed. Try again, or save the project file and open an issue with it attached.');
    } finally { setBusy(null); }
  };
  return (
    <span className="budget-export" role="group" aria-label="Export the budget">
      <span className="small muted" aria-hidden="true">Export</span>
      {KINDS.map(k => (
        <button key={k.kind} type="button" className="btn small" aria-label={k.name} title={k.name} disabled={busy !== null} onClick={() => run(k.kind, k.mime)}>
          {busy === k.kind ? 'Working…' : k.label}
        </button>
      ))}
    </span>
  );
}
