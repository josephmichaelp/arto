import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { toCsv, fromCsv } from "./csv";
import type { ExportRow } from "./types";

/** Arbitrary teks bebas, termasuk koma, tanda kutip, baris baru, dan karakter non-ASCII. */
const field = fc.string();

/** Arbitrary nominal bilangan bulat (boleh negatif, menyesuaikan Math.trunc pada toCsv/fromCsv). */
const amount = fc.integer({ min: -1_000_000_000, max: 1_000_000_000 });

/** Arbitrary satu ExportRow dengan bidang teks bebas. */
const exportRow: fc.Arbitrary<ExportRow> = fc.record({
  date: field,
  type: field,
  category: field,
  wallet: field,
  amount,
  note: field,
});

describe("toCsv / fromCsv", () => {
  it("contoh: baris sederhana round trip", () => {
    const rows: ExportRow[] = [
      {
        date: "2025-08-17",
        type: "expense",
        category: "Makanan",
        wallet: "Tunai",
        amount: 35000,
        note: "Makan siang",
      },
    ];
    expect(fromCsv(toCsv(rows))).toEqual(rows);
  });

  it("contoh: bidang berisi koma, tanda kutip, dan baris baru round trip", () => {
    const rows: ExportRow[] = [
      {
        date: "2025-08-17",
        type: "income",
        category: 'Bonus, "spesial"',
        wallet: "Bank\nBCA",
        amount: 1500000,
        note: 'Catatan dengan koma, "kutip", dan baris baru\nberikutnya',
      },
    ];
    expect(fromCsv(toCsv(rows))).toEqual(rows);
  });

  it("contoh: daftar kosong menghasilkan daftar kosong setelah round trip", () => {
    expect(fromCsv(toCsv([]))).toEqual([]);
  });

  it("contoh: nominal ditulis sebagai bilangan bulat tanpa pemisah pada CSV", () => {
    const rows: ExportRow[] = [
      {
        date: "2025-08-17",
        type: "expense",
        category: "Transportasi",
        wallet: "Tunai",
        amount: 1234567,
        note: "",
      },
    ];
    const csv = toCsv(rows);
    const dataLine = csv.split("\r\n")[1];
    expect(dataLine).toContain(",1234567,");
    expect(dataLine).not.toMatch(/1\.234\.567/);
  });

  /**
   * Property 13: CSV round trip
   * Validates: Requirements 14.1, 14.3, 14.5
   */
  it("properti: fromCsv(toCsv(rows)) sama dengan rows, dan nominal berupa bilangan bulat tanpa pemisah", () => {
    fc.assert(
      fc.property(fc.array(exportRow, { maxLength: 20 }), (rows) => {
        const normalized = rows.map((row) => ({
          ...row,
          amount: Math.trunc(row.amount),
        }));
        const csv = fromCsv(toCsv(rows));
        expect(csv).toEqual(normalized);
        for (const row of normalized) {
          expect(String(row.amount)).toMatch(/^-?\d+$/);
        }
      }),
    );
  });
});
