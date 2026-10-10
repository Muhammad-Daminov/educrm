import { describe, expect, it } from 'vitest';
import { parseCsv } from '../../src/students/import/csv.util';

describe('parseCsv', () => {
  it('parses a simple file', () => {
    const result = parseCsv('name,phone\nAli,901234567\nVali,907654321\n');
    expect(result.headers).toEqual(['name', 'phone']);
    expect(result.rows).toEqual([
      ['Ali', '901234567'],
      ['Vali', '907654321'],
    ]);
  });

  it('handles quoted fields with embedded commas and newlines', () => {
    const result = parseCsv('name,notes\n"Aliyev, Vali","Line one\nLine two"\n');
    expect(result.rows).toEqual([['Aliyev, Vali', 'Line one\nLine two']]);
  });

  it('handles an escaped quote inside a quoted field', () => {
    const result = parseCsv('name\n"Said ""the boss"" Aliyev"\n');
    expect(result.rows).toEqual([['Said "the boss" Aliyev']]);
  });

  it('strips a UTF-8 BOM', () => {
    const result = parseCsv('﻿name,phone\nAli,901234567\n');
    expect(result.headers).toEqual(['name', 'phone']);
  });

  it('tolerates a missing trailing newline', () => {
    const result = parseCsv('name\nAli');
    expect(result.rows).toEqual([['Ali']]);
  });

  it('tolerates CRLF line endings', () => {
    const result = parseCsv('name,phone\r\nAli,901234567\r\n');
    expect(result.rows).toEqual([['Ali', '901234567']]);
  });

  it('returns no rows for an empty file', () => {
    const result = parseCsv('');
    expect(result.headers).toEqual([]);
    expect(result.rows).toEqual([]);
  });
});
