// Small RFC 4180 CSV reader and writer (Node built-ins only). OWNER: Asset engineer.
//
// design/assets.csv is written with CRLF line endings and quoted fields that contain commas, so a line split is not enough.

/**
 * Parse CSV text into an array of rows (arrays of strings). Handles quoted fields, doubled quotes, commas and line breaks inside
 * quotes, CRLF, LF and a final line without a line break. A trailing empty line is ignored.
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  while (i < src.length) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === '') {
      inQuotes = true;
      i++;
    } else if (ch === ',') {
      row.push(field);
      field = '';
      i++;
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
    } else {
      field += ch;
      i++;
    }
  }
  if (inQuotes) throw new Error('CSV ends inside a quoted field');
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Parse CSV with a header row into an array of objects keyed by the header names. */
export function parseCsvObjects(text) {
  const [header, ...rows] = parseCsv(text);
  if (!header) return [];
  return rows
    .filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ''))
    .map((r) => Object.fromEntries(header.map((name, k) => [name, r[k] ?? ''])));
}

/** Quote a field when it contains a comma, a quote or a line break. */
export const csvField = (value) => {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Serialise rows (arrays) to CSV text with LF line endings and a final line break. */
export const toCsv = (rows) => `${rows.map((r) => r.map(csvField).join(',')).join('\n')}\n`;
