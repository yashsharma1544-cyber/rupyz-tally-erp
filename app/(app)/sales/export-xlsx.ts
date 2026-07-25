'use client';

/**
 * Shared XLSX export for the Sales screens.
 * exceljs is loaded on demand so it stays out of the main bundle.
 */

export type ColType = 'text' | 'number' | 'money' | 'percent' | 'int';

export type XlsxColumn = {
  key: string;
  header: string;
  width?: number;
  type?: ColType;
};

export type XlsxOptions = {
  filename: string;
  sheetName?: string;
  title: string;
  subtitle?: string;
  columns: XlsxColumn[];
  rows: Record<string, unknown>[];
  /** Optional totals row, keyed the same as columns. */
  totals?: Record<string, unknown>;
  /** Highlight one column (e.g. the live JC) in teal. */
  highlightHeaders?: string[];
};

const TEAL = 'FF0F766E';
const TEAL_SOFT = 'FFCCFBF1';
const GREY = 'FFF3F4F6';

// Indian digit grouping (lakh / crore)
const FMT = {
  number: '#,##,##0',
  int: '#,##0',
  money: '"₹"#,##,##0',
  percent: '0.0"%";[Red]-0.0"%"',
} as const;

export async function exportXlsx(opts: XlsxOptions) {
  const ExcelJS = (await import('exceljs')).default;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Sushil Agencies ERP';
  wb.created = new Date();

  const ws = wb.addWorksheet(opts.sheetName ?? 'Sales', {
    views: [{ state: 'frozen', ySplit: opts.subtitle ? 4 : 3 }],
  });

  const lastCol = opts.columns.length;

  // --- Title block -------------------------------------------------
  ws.mergeCells(1, 1, 1, lastCol);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = opts.title;
  titleCell.font = { bold: true, size: 14, color: { argb: TEAL } };
  titleCell.alignment = { vertical: 'middle' };
  ws.getRow(1).height = 22;

  let headerRowIdx = 2;
  if (opts.subtitle) {
    ws.mergeCells(2, 1, 2, lastCol);
    const sub = ws.getCell(2, 1);
    sub.value = opts.subtitle;
    sub.font = { size: 10, color: { argb: 'FF6B7280' } };
    headerRowIdx = 3;
  }
  ws.getRow(headerRowIdx - 1 + 1).height = 4; // spacer handled below

  // --- Header ------------------------------------------------------
  const header = ws.getRow(headerRowIdx + 1);
  opts.columns.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.header;
    const hot = opts.highlightHeaders?.includes(c.header);
    cell.font = { bold: true, size: 10, color: { argb: hot ? TEAL : 'FF374151' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: hot ? TEAL_SOFT : GREY },
    };
    cell.alignment = {
      vertical: 'middle',
      horizontal: c.type && c.type !== 'text' ? 'right' : 'left',
      wrapText: true,
    };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } } };
  });
  header.height = 20;

  // --- Body --------------------------------------------------------
  opts.rows.forEach((r) => {
    const row = ws.addRow(opts.columns.map((c) => normalise(r[c.key], c.type)));
    opts.columns.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      applyFormat(cell, c);
      if (opts.highlightHeaders?.includes(c.header)) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0FDFA' } };
      }
    });
  });

  // --- Totals ------------------------------------------------------
  if (opts.totals) {
    const row = ws.addRow(opts.columns.map((c) => normalise(opts.totals![c.key], c.type)));
    opts.columns.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      applyFormat(cell, c);
      cell.font = { bold: true, size: 10 };
      cell.border = { top: { style: 'medium', color: { argb: 'FF9CA3AF' } } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREY } };
    });
  }

  // --- Widths + filter ---------------------------------------------
  opts.columns.forEach((c, i) => {
    ws.getColumn(i + 1).width =
      c.width ?? Math.max(10, Math.min(34, c.header.length + 4));
  });

  ws.autoFilter = {
    from: { row: headerRowIdx + 1, column: 1 },
    to: { row: headerRowIdx + 1 + opts.rows.length, column: lastCol },
  };

  // --- Download -----------------------------------------------------
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = opts.filename.endsWith('.xlsx') ? opts.filename : `${opts.filename}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

function normalise(v: unknown, type?: ColType) {
  if (v == null || v === '') return type && type !== 'text' ? null : '';
  if (type && type !== 'text') {
    const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.-]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return v as string | number;
}

function applyFormat(
  cell: { numFmt: string; alignment: unknown; font?: unknown },
  c: XlsxColumn
) {
  if (!c.type || c.type === 'text') {
    cell.alignment = { horizontal: 'left' };
    return;
  }
  cell.numFmt = FMT[c.type];
  cell.alignment = { horizontal: 'right' };
}

/** Timestamp suffix for filenames: 2026-07-25_1815 */
export function stamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(
    d.getMinutes()
  )}`;
}
