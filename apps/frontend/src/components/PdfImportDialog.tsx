import { useState } from "react";
import {
  confirmPdfImport, downloadPdfXlsx, extractPdf, previewPdfTable,
  type Connection, type PdfConfirmResult, type PdfExtract, type PdfPreview, type PdfTable,
} from "../lib/api";

type Step = "upload" | "pick" | "edit" | "review" | "done";

const MAX_SHOWN = 200;
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
const field = "rounded-md border border-slate-700 bg-surface px-2 py-1.5 text-sm";

const genericNames = (n: number) => Array.from({ length: n }, (_, i) => `column_${i + 1}`);
const namesFor = (rows: string[][], header: boolean) =>
  header ? rows[0].map((c, i) => c || `column_${i + 1}`) : genericNames(rows[0].length);

function suggestName(filename: string, page: number): string {
  const stem = filename.replace(/\.pdf$/i, "").toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "pdf_table";
  return `${/^\d/.test(stem) ? "t_" : ""}${stem}_p${page}`.slice(0, 60);
}

export default function PdfImportDialog({ connection, schema, onClose, onImported }: {
  connection: Connection;
  schema: string;
  onClose: () => void;
  onImported: (r: PdfConfirmResult) => void;
}) {
  const [step, setStep] = useState<Step>("upload");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [extract, setExtract] = useState<PdfExtract | null>(null);
  const [picked, setPicked] = useState<PdfTable | null>(null);
  const [headerRow, setHeaderRow] = useState(true);
  const [names, setNames] = useState<string[]>([]);
  const [include, setInclude] = useState<boolean[]>([]);
  const [removed, setRemoved] = useState<Set<number>>(new Set());
  const [tableName, setTableName] = useState("");
  const [onErrorMode, setOnErrorMode] = useState<"abort" | "skip">("abort");
  const [preview, setPreview] = useState<PdfPreview | null>(null);
  const [result, setResult] = useState<PdfConfirmResult | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await fn(); }
    catch (e) { setError(e instanceof Error ? e.message : "Something went wrong"); }
    finally { setBusy(false); }
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    run(async () => {
      const ex = await extractPdf(file);
      setExtract(ex);
      setStep("pick");
    });
  };

  const pick = (t: PdfTable) => {
    setPicked(t);
    setHeaderRow(t.header_guess);
    setNames(namesFor(t.rows, t.header_guess));
    setInclude(t.rows[0].map(() => true));
    setRemoved(new Set());
    setTableName(suggestName(extract?.filename ?? "", t.page));
    setPreview(null);
    setError("");
    setStep("edit");
  };

  const toggleHeader = (value: boolean) => {
    if (!picked) return;
    setHeaderRow(value);
    setNames(namesFor(picked.rows, value));
    setRemoved(new Set());
  };

  const build = () => {
    const base = picked?.rows ?? [];
    const cols = include.map((inc, i) => (inc ? i : -1)).filter((i) => i >= 0);
    const dataRows = base.filter((_, i) => !(headerRow && i === 0) && !removed.has(i));
    return {
      headers: cols.map((i) => names[i] ?? ""),
      rows: dataRows.map((r) => cols.map((i) => r[i] ?? "")),
    };
  };

  const onCheck = () => {
    const { headers, rows } = build();
    if (headers.length === 0) { setError("Keep at least one column."); return; }
    if (rows.length === 0) { setError("There are no data rows left."); return; }
    if (!NAME_RE.test(tableName)) {
      setError("Table name: start with a letter or underscore, then letters, digits or underscores (max 63).");
      return;
    }
    run(async () => {
      setPreview(await previewPdfTable(headers, rows));
      setStep("review");
    });
  };

  const onConfirm = () =>
    run(async () => {
      const { headers, rows } = build();
      const r = await confirmPdfImport({
        headers, rows, connection_id: connection.id, schema_name: schema,
        table_name: tableName, on_error: onErrorMode, confirm: true,
      });
      setResult(r);
      if (r.report.status === "ok") setStep("done");
      else setError(r.report.message);
    });

  const base = picked?.rows ?? [];
  const visibleRows = base
    .map((r, i) => ({ r, i }))
    .filter(({ i }) => !(headerRow && i === 0) && !removed.has(i));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="max-h-[90vh] w-full max-w-5xl space-y-4 overflow-auto rounded-xl border border-slate-700 bg-modal p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Import a table from a PDF</h2>
          <button onClick={onClose} className="text-sm text-slate-400 hover:text-white">Close</button>
        </div>
        <p className="text-xs text-slate-500">
          Target: {connection.name} / {schema}. Nothing is written until you answer "Correct" in the last step.
        </p>
        {error && <p className="text-sm text-red-400">{error}</p>}
        {busy && <p className="text-sm text-slate-400">Working...</p>}

        {step === "upload" && (
          <div className="space-y-2">
            <input type="file" accept="application/pdf,.pdf" disabled={busy} onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} className="text-sm text-slate-300" />
            <p className="text-xs text-slate-500">Text-based PDFs only (max 20 MB, first 30 pages). The PDF itself is not stored.</p>
          </div>
        )}

        {step === "pick" && extract && (
          <div className="space-y-3">
            <p className="text-sm text-slate-300">
              Found {extract.tables.length} table(s) in {extract.filename} ({extract.pages_scanned} of {extract.pages_total} pages scanned). <b>Which table do you want to import?</b>
            </p>
            {extract.notes.map((n, i) => <p key={i} className="text-xs text-amber-300">{n}</p>)}
            {extract.tables.map((t) => (
              <div key={t.id} className="rounded-lg border border-slate-800 bg-surface p-3">
                <div className="mb-2 flex items-center gap-3 text-xs text-slate-400">
                  <span className="font-medium text-slate-200">Page {t.page}</span>
                  <span>{t.rows.length} rows × {t.rows[0].length} columns</span>
                  {t.method === "text-alignment" && <span className="text-amber-300">guessed from text alignment</span>}
                  <button onClick={() => pick(t)} className="ml-auto rounded-md bg-cyan-500 px-3 py-1 font-medium text-slate-950">Use this table</button>
                </div>
                <div className="overflow-auto">
                  <table className="w-full text-xs">
                    <tbody>
                      {t.rows.slice(0, 5).map((r, i) => (
                        <tr key={i} className="border-t border-slate-800/60">
                          {r.map((c, j) => <td key={j} className="max-w-40 truncate whitespace-nowrap p-1.5">{c}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
            <button onClick={() => { setStep("upload"); setExtract(null); }} className="rounded-md border border-slate-600 px-3 py-1.5 text-sm">Upload a different file</button>
          </div>
        )}

        {step === "edit" && picked && (
          <div className="space-y-3">
            <p className="text-sm text-slate-300"><b>What is this table for?</b> Give it a name and check the columns.</p>
            {picked.truncated && <p className="text-xs text-amber-300">This table was cut to 2000 rows and 50 columns.</p>}
            <div className="flex flex-wrap items-center gap-3">
              <input value={tableName} onChange={(e) => setTableName(e.target.value)} placeholder="Table name" className={`${field} w-64`} />
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input type="checkbox" checked={headerRow} onChange={(e) => toggleHeader(e.target.checked)} /> First row is the header
              </label>
            </div>
            <div className="max-h-80 overflow-auto rounded-md border border-slate-800">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-900">
                  <tr>
                    <th className="p-1.5" />
                    {names.map((n, i) => (
                      <th key={i} className="p-1.5 text-left font-normal">
                        <label className="mb-1 flex items-center gap-1 text-slate-500">
                          <input type="checkbox" checked={include[i]} onChange={(e) => setInclude((p) => p.map((v, k) => (k === i ? e.target.checked : v)))} /> keep
                        </label>
                        <input value={n} onChange={(e) => setNames((p) => p.map((v, k) => (k === i ? e.target.value : v)))} className={`${field} w-32 ${include[i] ? "" : "opacity-40"}`} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.slice(0, MAX_SHOWN).map(({ r, i }) => (
                    <tr key={i} className="border-t border-slate-800/60">
                      <td className="p-1.5"><button onClick={() => setRemoved((p) => new Set(p).add(i))} title="Remove this row" className="text-red-400">×</button></td>
                      {r.map((c, j) => <td key={j} className={`max-w-40 truncate whitespace-nowrap p-1.5 ${include[j] ? "" : "opacity-30"}`}>{c}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-500">
              {visibleRows.length} data row(s){visibleRows.length > MAX_SHOWN && ` (showing the first ${MAX_SHOWN}; all will be imported)`}. Cell values cannot be edited here. Fix them in the PDF or with SQL after the import.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setStep("pick")} className="rounded-md border border-slate-600 px-3 py-1.5 text-sm">Back</button>
              <button onClick={onCheck} disabled={busy} className="rounded-md bg-cyan-500 px-4 py-1.5 text-sm font-medium text-slate-950 disabled:opacity-40">Check</button>
            </div>
          </div>
        )}

        {step === "review" && preview && (
          <div className="space-y-3">
            <p className="text-sm text-slate-300">
              This is how I understood the table. I will create <b>{schema}.{tableName}</b> with {preview.row_count} row(s). <b>Is this correct?</b>
            </p>
            <div className="max-h-64 overflow-auto rounded-md border border-slate-800">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-900 text-left text-slate-300">
                  <tr><th className="p-2">Column</th><th className="p-2">Detected type</th><th className="p-2">Empty</th><th className="p-2">Distinct</th><th className="p-2">Samples</th></tr>
                </thead>
                <tbody>
                  {preview.columns.map((c) => (
                    <tr key={c.index} className="border-t border-slate-800/60">
                      <td className="p-2">{c.name}</td><td className="p-2 text-cyan-300">{c.inferred_type}</td>
                      <td className="p-2">{c.null_count}</td><td className="p-2">{c.distinct_count}</td>
                      <td className="max-w-xs truncate p-2 text-slate-400">{c.samples.join(" | ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.duplicate_row_count > 0 && <p className="text-xs text-amber-300">{preview.duplicate_row_count} exact duplicate row(s) found. They will still be imported.</p>}
            <label className="flex items-center gap-2 text-sm text-slate-300">
              If a row has an invalid value:
              <select value={onErrorMode} onChange={(e) => setOnErrorMode(e.target.value as "abort" | "skip")} className={field}>
                <option value="abort">Import nothing</option>
                <option value="skip">Skip invalid rows</option>
              </select>
            </label>
            <div className="flex gap-2">
              <button onClick={() => { setStep("edit"); setError(""); }} className="rounded-md border border-slate-600 px-4 py-2 text-sm">No, change something</button>
              <button onClick={onConfirm} disabled={busy} className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 disabled:opacity-40">Correct, create the table</button>
            </div>
            {result && result.report.status === "failed" && result.report.errors.length > 0 && (
              <ul className="space-y-0.5 text-xs text-red-300">
                {result.report.errors.slice(0, 10).map((e, i) => <li key={i}>Row {e.row}, {e.column}: {e.message} ("{e.value}")</li>)}
              </ul>
            )}
          </div>
        )}

        {step === "done" && result && (
          <div className="space-y-3">
            <p className="text-sm text-emerald-400">{result.report.message}</p>
            <p className="text-xs text-slate-400">
              Table rows {result.report.db_rows_before} → {result.report.db_rows_after} (verified in the database).
            </p>
            <div className="flex flex-wrap gap-2">
              {result.xlsx_import_id && (
                <button onClick={() => run(() => downloadPdfXlsx(result.xlsx_import_id as string, `${result.table_name}.xlsx`))}
                  className="rounded-md border border-slate-600 px-4 py-2 text-sm">Download the Excel file</button>
              )}
              <button onClick={() => onImported(result)} className="rounded-md bg-cyan-500 px-4 py-2 text-sm font-medium text-slate-950">
                Add {result.queries.length} starter queries to the editor
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
