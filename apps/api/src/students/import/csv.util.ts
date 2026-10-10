/**
 * A minimal RFC 4180 CSV parser: quoted fields, embedded commas/newlines,
 * and `""` as an escaped quote. Hand-rolled rather than a dependency —
 * TZ M11.1 only asks for CSV/XLSX import and XLSX (a binary, zip-based
 * format) is deferred (see docs/QUESTIONS.md); a parser this small isn't
 * worth a package for.
 */
export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

export function parseCsv(text: string): ParsedCsv {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  // Strip a UTF-8 BOM, which Excel writes in front of every CSV it exports.
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const pushField = (): void => {
    row.push(field);
    field = '';
  };
  const pushRow = (): void => {
    pushField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      pushField();
    } else if (char === '\r') {
      // Swallowed; \n (bare or following \r) ends the row.
    } else if (char === '\n') {
      pushRow();
    } else {
      field += char;
    }
  }
  // A trailing newline leaves nothing to flush; anything else is the last row.
  if (field !== '' || row.length > 0) {
    pushRow();
  }

  const nonEmpty = rows.filter((candidate) => !(candidate.length === 1 && candidate[0] === ''));
  const [headers, ...dataRows] = nonEmpty;
  return { headers: headers ?? [], rows: dataRows };
}
