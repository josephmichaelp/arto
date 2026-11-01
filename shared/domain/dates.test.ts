import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { addDays, formatDateId, toJakartaDate, toJakartaMonth } from "./dates";

const BULAN_ID = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

/** Arbitrary instan UTC sebagai timestamp ms, dari tahun 1970 sampai 2100. */
const instantArb = fc
  .integer({ min: 0, max: Date.UTC(2100, 0, 1) })
  .map((ms) => new Date(ms));

/**
 * Menghitung tanggal `YYYY-MM-DD` menurut WIB (UTC+7) secara independen dari
 * implementasi `toJakartaDate`, dengan menambah 7 jam langsung pada
 * komponen UTC lewat `Date`.
 */
function expectedJakartaDate(instant: Date): string {
  const jakarta = new Date(instant.getTime() + 7 * 60 * 60 * 1000);
  const y = jakarta.getUTCFullYear();
  const m = jakarta.getUTCMonth() + 1;
  const d = jakarta.getUTCDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

describe("toJakartaDate - Property 19: Tanggal dan batas hari mengikuti WIB", () => {
  it("contoh: tengah hari UTC jatuh pada tanggal yang sama di WIB", () => {
    expect(toJakartaDate(new Date("2025-08-17T05:00:00.000Z"))).toBe(
      "2025-08-17",
    );
  });

  it("contoh: tepat 17:00 UTC adalah batas hari, sudah masuk hari berikutnya di WIB", () => {
    expect(toJakartaDate(new Date("2025-08-17T17:00:00.000Z"))).toBe(
      "2025-08-18",
    );
  });

  it("contoh: 16:59:59.999 UTC masih hari sebelumnya di WIB", () => {
    expect(toJakartaDate(new Date("2025-08-17T16:59:59.999Z"))).toBe(
      "2025-08-17",
    );
  });

  it("contoh: menerima string ISO UTC selain objek Date", () => {
    expect(toJakartaDate("2025-08-17T17:00:00.000Z")).toBe("2025-08-18");
  });

  /**
   * Validates: Requirements 10.6, 15.3
   */
  it("properti: toJakartaDate selalu sama dengan tanggal pada UTC+7", () => {
    fc.assert(
      fc.property(instantArb, (instant) => {
        expect(toJakartaDate(instant)).toBe(expectedJakartaDate(instant));
      }),
    );
  });

  /**
   * Validates: Requirements 10.6, 15.3
   */
  it("properti: toJakartaMonth konsisten dengan tanggal yang dihasilkan toJakartaDate", () => {
    fc.assert(
      fc.property(instantArb, (instant) => {
        const date = toJakartaDate(instant);
        expect(toJakartaMonth(instant)).toBe(date.slice(0, 7));
      }),
    );
  });

  /**
   * Validates: Requirements 10.6, 15.3
   */
  it("properti: menambah 24 jam pada instan selalu menggeser tanggal WIB tepat satu hari", () => {
    fc.assert(
      fc.property(instantArb, (instant) => {
        const date = toJakartaDate(instant);
        const next = toJakartaDate(new Date(instant.getTime() + 24 * 60 * 60 * 1000));
        expect(next).toBe(addDays(date, 1));
      }),
    );
  });
});

describe("formatDateId - Property 19: Tanggal dan batas hari mengikuti WIB", () => {
  it("contoh: 17 Agustus 2025 diformat sesuai contoh requirement", () => {
    expect(formatDateId("2025-08-17")).toBe("17 Agustus 2025");
  });

  it("contoh: tanggal awal bulan tidak memakai angka nol di depan", () => {
    expect(formatDateId("2025-01-01")).toBe("1 Januari 2025");
  });

  /**
   * Validates: Requirements 10.6, 15.3
   */
  it("properti: formatDateId selalu menghasilkan 'D Bulan YYYY' dengan nama bulan bahasa Indonesia dan konsisten dengan toJakartaDate", () => {
    fc.assert(
      fc.property(instantArb, (instant) => {
        const date = toJakartaDate(instant);
        const [yearStr, monthStr, dayStr] = date.split("-");
        const expected = `${Number(dayStr)} ${BULAN_ID[Number(monthStr) - 1]} ${yearStr}`;
        expect(formatDateId(date)).toBe(expected);
      }),
    );
  });

  /**
   * Validates: Requirements 10.6, 15.3
   */
  it("properti: hasil formatDateId cocok dengan pola 'D Bulan YYYY' tanpa angka nol di depan pada hari", () => {
    fc.assert(
      fc.property(instantArb, (instant) => {
        const date = toJakartaDate(instant);
        const formatted = formatDateId(date);
        expect(formatted).toMatch(/^[1-9][0-9]? [A-Za-zÀ-ÿ]+ \d{4}$/);
      }),
    );
  });
});
