import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { Frequency, RuleLike, RuleStatus } from "./types";
import { dueOccurrences, occurrence, reminderDue } from "./recurring";

/**
 * Property 11: Tanggal jatuh tempo berulang dengan clamp akhir bulan.
 *
 * Validates: Requirements 6.2, 6.3, 6.5
 *
 * `occurrence` selalu dihitung dari tanggal mulai asli, di-clamp ke hari
 * terakhir bulan, tidak menurun terhadap indeks; `dueOccurrences` hanya
 * mengembalikan kejadian dengan tanggal <= hari ini, paling banyak `limit`
 * (default 366) per pemanggilan, dan kosong untuk aturan dijeda;
 * `reminderDue` mengembalikan kejadian berikutnya tepat pada H-3.
 */

const FREQUENCIES: Frequency[] = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function daysInMonth0(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Pisah `YYYY-MM-DD` menjadi tuple angka `[year, month1, day]`. */
function parts(date: string): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) {
    throw new Error(`Tanggal tidak valid: ${date}`);
  }
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * Implementasi referensi independen dari `occurrence`, memakai aritmetika
 * `Date` UTC yang berbeda, untuk memverifikasi hasil tanpa menyalin logika
 * produksi.
 */
function expectedOccurrence(
  startDate: string,
  frequency: Frequency,
  index: number,
): string {
  const [year, month1, day] = parts(startDate);
  const month0 = month1 - 1;
  switch (frequency) {
    case "DAILY":
      return ymd(new Date(Date.UTC(year, month0, day + index)));
    case "WEEKLY":
      return ymd(new Date(Date.UTC(year, month0, day + index * 7)));
    case "MONTHLY": {
      const total = month0 + index;
      const ty = year + Math.floor(total / 12);
      const tm = ((total % 12) + 12) % 12;
      const clamped = Math.min(day, daysInMonth0(ty, tm));
      return ymd(new Date(Date.UTC(ty, tm, clamped)));
    }
    case "YEARLY": {
      const ty = year + index;
      const clamped = Math.min(day, daysInMonth0(ty, month0));
      return ymd(new Date(Date.UTC(ty, month0, clamped)));
    }
    default:
      throw new Error("Frekuensi tidak dikenal");
  }
}

/** Arbitrary tanggal `YYYY-MM-DD` valid antara 2000-01-01 dan 2100-12-31. */
const dateArb = fc
  .record({
    year: fc.integer({ min: 2000, max: 2100 }),
    month0: fc.integer({ min: 0, max: 11 }),
    day: fc.integer({ min: 1, max: 31 }),
  })
  .map(({ year, month0, day }) => {
    const clampedDay = Math.min(day, daysInMonth0(year, month0));
    return `${year}-${pad2(month0 + 1)}-${pad2(clampedDay)}`;
  });

const frequencyArb = fc.constantFrom(...FREQUENCIES);
const statusArb = fc.constantFrom<RuleStatus>("ACTIVE", "PAUSED");

const ruleArb = fc.record({
  startDate: dateArb,
  frequency: frequencyArb,
  nextIndex: fc.integer({ min: 0, max: 50 }),
  status: statusArb,
}).map(
  (r): RuleLike => ({
    id: "rule-1",
    frequency: r.frequency,
    startDate: r.startDate,
    nextIndex: r.nextIndex,
    status: r.status,
  }),
);

describe("occurrence - Property 11", () => {
  it("contoh: 31 Januari bulanan di-clamp ke akhir Februari (bukan kabisat)", () => {
    expect(occurrence("2025-01-31", "MONTHLY", 1)).toBe("2025-02-28");
  });

  it("contoh: 31 Januari bulanan di-clamp ke 29 Februari pada tahun kabisat", () => {
    expect(occurrence("2024-01-31", "MONTHLY", 1)).toBe("2024-02-29");
  });

  it("contoh: 29 Februari tahunan di-clamp ke 28 Februari tahun biasa", () => {
    expect(occurrence("2024-02-29", "YEARLY", 1)).toBe("2025-02-28");
  });

  it("contoh: 31 Januari bulanan tetap 31 Maret karena Maret punya 31 hari", () => {
    expect(occurrence("2025-01-31", "MONTHLY", 2)).toBe("2025-03-31");
  });

  it("contoh: harian menambah hari persis", () => {
    expect(occurrence("2025-01-30", "DAILY", 5)).toBe("2025-02-04");
  });

  it("contoh: mingguan menambah kelipatan tujuh hari", () => {
    expect(occurrence("2025-01-01", "WEEKLY", 3)).toBe("2025-01-22");
  });

  it("menolak indeks negatif atau bukan bilangan bulat", () => {
    expect(() => occurrence("2025-01-01", "DAILY", -1)).toThrow();
    expect(() => occurrence("2025-01-01", "DAILY", 1.5)).toThrow();
  });

  /** Validates: Requirements 6.2, 6.3 */
  it("properti: occurrence dihitung dari tanggal mulai asli (cocok dengan implementasi referensi)", () => {
    fc.assert(
      fc.property(dateArb, frequencyArb, fc.integer({ min: 0, max: 500 }), (start, freq, i) => {
        expect(occurrence(start, freq, i)).toBe(expectedOccurrence(start, freq, i));
      }),
    );
  });

  /** Validates: Requirements 6.3 */
  it("properti: tanggal tidak pernah melewati hari terakhir bulan (clamp)", () => {
    fc.assert(
      fc.property(dateArb, frequencyArb, fc.integer({ min: 0, max: 500 }), (start, freq, i) => {
        const date = occurrence(start, freq, i);
        const [y, m, d] = parts(date);
        expect(d).toBeLessThanOrEqual(daysInMonth0(y, m - 1));
        expect(d).toBeGreaterThanOrEqual(1);
        expect(m).toBeGreaterThanOrEqual(1);
        expect(m).toBeLessThanOrEqual(12);
      }),
    );
  });

  /** Validates: Requirements 6.2 */
  it("properti: occurrence tidak menurun terhadap indeks", () => {
    fc.assert(
      fc.property(dateArb, frequencyArb, fc.integer({ min: 0, max: 400 }), (start, freq, i) => {
        // Perbandingan leksikografis string YYYY-MM-DD setara urutan kronologis.
        expect(occurrence(start, freq, i + 1) >= occurrence(start, freq, i)).toBe(true);
      }),
    );
  });

  /** Validates: Requirements 6.3 */
  it("properti: untuk MONTHLY/YEARLY hari sama dengan min(hari mulai, hari dalam bulan target)", () => {
    fc.assert(
      fc.property(
        dateArb,
        fc.constantFrom<Frequency>("MONTHLY", "YEARLY"),
        fc.integer({ min: 0, max: 500 }),
        (start, freq, i) => {
          const [, , startDay] = parts(start);
          const [y, m, resultDay] = parts(occurrence(start, freq, i));
          expect(resultDay).toBe(Math.min(startDay, daysInMonth0(y, m - 1)));
        },
      ),
    );
  });
});

describe("dueOccurrences - Property 11", () => {
  it("contoh: aturan dijeda tidak pernah menghasilkan kejadian", () => {
    const rule: RuleLike = {
      id: "r",
      frequency: "DAILY",
      startDate: "2020-01-01",
      nextIndex: 0,
      status: "PAUSED",
    };
    expect(dueOccurrences(rule, "2025-01-01")).toEqual([]);
  });

  it("contoh: harian sejak lampau dibatasi 366 kejadian per pemanggilan secara default", () => {
    const rule: RuleLike = {
      id: "r",
      frequency: "DAILY",
      startDate: "2000-01-01",
      nextIndex: 0,
      status: "ACTIVE",
    };
    expect(dueOccurrences(rule, "2025-01-01")).toHaveLength(366);
  });

  it("contoh: hanya mengembalikan kejadian hingga hari ini inklusif", () => {
    const rule: RuleLike = {
      id: "r",
      frequency: "DAILY",
      startDate: "2025-01-01",
      nextIndex: 0,
      status: "ACTIVE",
    };
    const result = dueOccurrences(rule, "2025-01-03");
    expect(result.map((o) => o.date)).toEqual(["2025-01-01", "2025-01-02", "2025-01-03"]);
  });

  /** Validates: Requirements 6.4 */
  it("properti: aturan dijeda selalu mengembalikan daftar kosong", () => {
    fc.assert(
      fc.property(
        ruleArb.filter((r) => r.status === "PAUSED"),
        dateArb,
        (rule, today) => {
          expect(dueOccurrences(rule, today)).toEqual([]);
        },
      ),
    );
  });

  /** Validates: Requirements 6.2 */
  it("properti: untuk aturan aktif, semua kejadian <= hari ini, dibatasi limit, indeks berurutan dari nextIndex", () => {
    fc.assert(
      fc.property(
        ruleArb.filter((r) => r.status === "ACTIVE"),
        dateArb,
        fc.integer({ min: 1, max: 366 }),
        (rule, today, limit) => {
          const result = dueOccurrences(rule, today, limit);
          expect(result.length).toBeLessThanOrEqual(limit);
          result.forEach((o, k) => {
            expect(o.index).toBe(rule.nextIndex + k);
            expect(o.date).toBe(occurrence(rule.startDate, rule.frequency, o.index));
            expect(o.date <= today).toBe(true);
          });
          // Jika berhenti sebelum limit, kejadian berikutnya harus melewati hari ini.
          if (result.length < limit) {
            const nextIdx = rule.nextIndex + result.length;
            expect(occurrence(rule.startDate, rule.frequency, nextIdx) > today).toBe(true);
          }
        },
      ),
    );
  });

  /** Validates: Requirements 6.2 */
  it("properti: default limit tidak pernah melebihi 366", () => {
    fc.assert(
      fc.property(
        ruleArb.filter((r) => r.status === "ACTIVE"),
        dateArb,
        (rule, today) => {
          expect(dueOccurrences(rule, today).length).toBeLessThanOrEqual(366);
        },
      ),
    );
  });
});

describe("reminderDue - Property 11", () => {
  it("contoh: mengingatkan tepat H-3 sebelum jatuh tempo berikutnya", () => {
    const rule: RuleLike = {
      id: "r",
      frequency: "MONTHLY",
      startDate: "2025-01-10",
      nextIndex: 0,
      status: "ACTIVE",
    };
    expect(reminderDue(rule, "2025-01-07")).toEqual({ index: 0, date: "2025-01-10" });
  });

  it("contoh: bukan H-3 mengembalikan null", () => {
    const rule: RuleLike = {
      id: "r",
      frequency: "MONTHLY",
      startDate: "2025-01-10",
      nextIndex: 0,
      status: "ACTIVE",
    };
    expect(reminderDue(rule, "2025-01-06")).toBeNull();
    expect(reminderDue(rule, "2025-01-08")).toBeNull();
  });

  it("contoh: aturan dijeda tidak pernah mengingatkan", () => {
    const rule: RuleLike = {
      id: "r",
      frequency: "MONTHLY",
      startDate: "2025-01-10",
      nextIndex: 0,
      status: "PAUSED",
    };
    expect(reminderDue(rule, "2025-01-07")).toBeNull();
  });

  /** Validates: Requirements 6.5 */
  it("properti: aturan dijeda selalu mengembalikan null", () => {
    fc.assert(
      fc.property(
        ruleArb.filter((r) => r.status === "PAUSED"),
        dateArb,
        (rule, today) => {
          expect(reminderDue(rule, today)).toBeNull();
        },
      ),
    );
  });

  /** Validates: Requirements 6.5 */
  it("properti: reminderDue tidak null jika dan hanya jika jatuh tempo berikutnya tepat H-3", () => {
    fc.assert(
      fc.property(
        ruleArb.filter((r) => r.status === "ACTIVE"),
        dateArb,
        (rule, today) => {
          const next = occurrence(rule.startDate, rule.frequency, rule.nextIndex);
          const [y, m, d] = parts(today);
          const target = ymd(new Date(Date.UTC(y, m - 1, d + 3)));
          const result = reminderDue(rule, today);
          if (next === target) {
            expect(result).toEqual({ index: rule.nextIndex, date: next });
          } else {
            expect(result).toBeNull();
          }
        },
      ),
    );
  });
});
