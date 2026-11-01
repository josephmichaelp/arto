import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { goalProgress, monthlyNeeded } from "./goals";

/** Bilangan bulat Rupiah yang aman untuk domain uji properti. */
const rupiah = fc.integer({ min: 0, max: 1_000_000_000_000 });
/** Target selalu lebih dari 0 sesuai prasyarat domain. */
const positiveTarget = fc.integer({ min: 1, max: 1_000_000_000_000 });

/** Membangun string `YYYY-MM-DD` dari komponen tahun dan bulan (hari tetap 01). */
function ym(year: number, month1: number): string {
  return `${String(year).padStart(4, "0")}-${String(month1).padStart(2, "0")}-01`;
}

describe("goalProgress", () => {
  it("contoh: menghitung persentase dan status tercapai", () => {
    expect(goalProgress(0, 100)).toEqual({ percent: 0, achieved: false });
    expect(goalProgress(50, 100)).toEqual({ percent: 0.5, achieved: false });
    expect(goalProgress(100, 100)).toEqual({ percent: 1, achieved: true });
    expect(goalProgress(150, 100)).toEqual({ percent: 1.5, achieved: true });
  });

  it("contoh: menolak target nol, negatif, atau bukan angka", () => {
    expect(() => goalProgress(10, 0)).toThrow();
    expect(() => goalProgress(10, -5)).toThrow();
    expect(() => goalProgress(10, Number.NaN)).toThrow();
    expect(() => goalProgress(10, Number.POSITIVE_INFINITY)).toThrow();
  });
});

describe("monthlyNeeded", () => {
  it("contoh: tanpa tenggat mengembalikan null", () => {
    expect(monthlyNeeded(0, 1_200_000, undefined, "2024-01-01")).toBeNull();
    expect(monthlyNeeded(0, 1_200_000, "", "2024-01-01")).toBeNull();
  });

  it("contoh: membagi sisa target dengan bulan tersisa dan membulatkan ke atas", () => {
    // 1.200.000 selama 12 bulan = 100.000 per bulan.
    expect(monthlyNeeded(0, 1_200_000, "2025-01-01", "2024-01-01")).toBe(100_000);
    // Pembulatan ke atas: 100 dibagi 3 bulan = 34.
    expect(monthlyNeeded(0, 100, "2024-04-01", "2024-01-01")).toBe(34);
  });

  it("contoh: minimal 1 bulan saat tenggat sama dengan atau sebelum hari ini", () => {
    expect(monthlyNeeded(0, 500, "2024-01-01", "2024-01-01")).toBe(500);
    expect(monthlyNeeded(0, 500, "2023-01-01", "2024-01-01")).toBe(500);
  });

  it("contoh: sisa target tidak pernah negatif saat sudah melebihi target", () => {
    expect(monthlyNeeded(1_500, 1_000, "2025-01-01", "2024-01-01")).toBe(0);
  });
});

describe("Property 14: Progres dan kebutuhan setoran bulanan Target_Tabungan", () => {
  /**
   * Validates: Requirements 7.3, 7.4, 7.5
   */
  it("properti: goalProgress menghasilkan percent = saved / target", () => {
    fc.assert(
      fc.property(rupiah, positiveTarget, (saved, target) => {
        expect(goalProgress(saved, target).percent).toBe(saved / target);
      }),
    );
  });

  /**
   * Validates: Requirements 7.3, 7.4, 7.5
   */
  it("properti: achieved benar tepat saat saved >= target", () => {
    fc.assert(
      fc.property(rupiah, positiveTarget, (saved, target) => {
        expect(goalProgress(saved, target).achieved).toBe(saved >= target);
      }),
    );
  });

  /**
   * Validates: Requirements 7.3, 7.4, 7.5
   */
  it("properti: goalProgress menolak target yang bukan bilangan positif", () => {
    fc.assert(
      fc.property(rupiah, fc.integer({ min: -1_000_000_000, max: 0 }), (saved, target) => {
        expect(() => goalProgress(saved, target)).toThrow();
      }),
    );
  });

  /**
   * Validates: Requirements 7.5
   */
  it("properti: monthlyNeeded mengembalikan null tepat saat tanpa tenggat", () => {
    fc.assert(
      fc.property(rupiah, positiveTarget, (saved, target) => {
        expect(monthlyNeeded(saved, target, undefined, "2024-01-01")).toBeNull();
      }),
    );
  });

  /**
   * Validates: Requirements 7.5
   *
   * monthlyNeeded SHALL sama dengan sisa target (minimal 0) dibagi jumlah bulan
   * tersisa (minimal 1) dibulatkan ke atas.
   */
  it("properti: monthlyNeeded = ceil(max(0, target - saved) / max(1, bulan tersisa))", () => {
    fc.assert(
      fc.property(
        rupiah,
        positiveTarget,
        fc.integer({ min: 2000, max: 2100 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 2000, max: 2100 }),
        fc.integer({ min: 1, max: 12 }),
        (saved, target, ty, tm, dy, dm) => {
          const today = ym(ty, tm);
          const deadline = ym(dy, dm);
          const monthsBetween = (dy - ty) * 12 + (dm - tm);
          const monthsRemaining = Math.max(1, monthsBetween);
          const remaining = Math.max(0, target - saved);
          const expected = Math.ceil(remaining / monthsRemaining);
          expect(monthlyNeeded(saved, target, deadline, today)).toBe(expected);
        },
      ),
    );
  });

  /**
   * Validates: Requirements 7.5
   *
   * Hasil monthlyNeeded selalu bilangan bulat tak negatif saat ada tenggat.
   */
  it("properti: monthlyNeeded selalu bilangan bulat tak negatif saat ada tenggat", () => {
    fc.assert(
      fc.property(
        rupiah,
        positiveTarget,
        fc.integer({ min: 2000, max: 2100 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 2000, max: 2100 }),
        fc.integer({ min: 1, max: 12 }),
        (saved, target, ty, tm, dy, dm) => {
          const result = monthlyNeeded(saved, target, ym(dy, dm), ym(ty, tm));
          expect(result).not.toBeNull();
          const value = result as number;
          expect(Number.isInteger(value)).toBe(true);
          expect(value).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });
});
