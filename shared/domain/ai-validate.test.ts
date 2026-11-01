import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { validateNlResult, validateReceiptResult } from "./ai-validate";
import type { Category } from "./types";

/**
 * Uji properti untuk Property 15: Hasil AI tidak valid tidak pernah disimpan
 * otomatis.
 *
 * Validates: Requirements 10.5, 10.6, 10.7, 11.4
 *
 * Kontrak yang diuji (lihat design.md Property 15 dan ai-validate.ts):
 * - `validateNlResult`/`validateReceiptResult` menerima `unknown` dan hanya
 *   menghasilkan `status: 'ok'` bila `type`, `amount`, dan `categoryId`
 *   seluruhnya valid. Selain itu menghasilkan `needs_amount` dengan draft.
 * - `categoryId` pada hasil valid hanya boleh dari `ctx.categories`.
 * - Tanggal kosong atau tidak berformat `YYYY-MM-DD` diganti `todayWib`.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Daftar Kategori milik Pengguna untuk konteks uji. */
const categories: Category[] = [
  { id: "cat-makan", name: "Makan", type: "EXPENSE" },
  { id: "cat-transport", name: "Transportasi", type: "EXPENSE" },
  { id: "cat-gaji", name: "Gaji", type: "INCOME" },
];

const categoryIds = categories.map((c) => c.id);

/** Generator untuk tanggal valid berformat YYYY-MM-DD. */
const validDate = fc
  .date({ min: new Date("2000-01-01"), max: new Date("2100-12-31"), noInvalidDate: true })
  .map((d) => d.toISOString().slice(0, 10));

/** todayWib yang dipakai sebagai konteks; nilai valid berformat YYYY-MM-DD. */
const todayWibArb = validDate;

/** Nominal valid: bilangan bulat positif. */
const validAmount = fc.integer({ min: 1, max: 1_000_000_000_000 });

/** Nilai yang bukan nominal valid (bukan bilangan bulat positif). */
const invalidAmount = fc.oneof(
  fc.integer({ min: -1_000_000, max: 0 }),
  fc.float({ min: -1_000_000, max: 1_000_000, noNaN: true }).filter((x) => !Number.isInteger(x)),
  fc.constantFrom<unknown>(null, undefined, "12000", "Rp 12.000", {}, [], true, NaN, Infinity),
);

/** Nilai `type` yang tidak valid. */
const invalidType = fc.oneof(
  fc.constantFrom<unknown>("expense", "income", "TRANSFER", "", null, undefined, 1, true, {}),
  fc.string().filter((s) => s !== "EXPENSE" && s !== "INCOME"),
);

/** categoryId yang tidak ada pada daftar Pengguna. */
const foreignCategoryId = fc
  .string()
  .filter((s) => s.length > 0 && !categoryIds.includes(s));

/** Keluaran model acak non-object (JSON rusak / teks acak / primitif). */
const nonObjectRaw = fc.oneof(
  fc.string(),
  fc.integer(),
  fc.boolean(),
  fc.constantFrom<unknown>(null, undefined),
  fc.array(fc.anything()),
);

describe("validateNlResult / validateReceiptResult", () => {
  it("contoh: keluaran lengkap dan valid menghasilkan status ok", () => {
    const result = validateNlResult(
      { type: "EXPENSE", amount: 12000, date: "2024-03-01", categoryId: "cat-makan" },
      { categories, todayWib: "2024-05-05" },
    );
    expect(result).toEqual({
      status: "ok",
      type: "EXPENSE",
      amount: 12000,
      date: "2024-03-01",
      categoryId: "cat-makan",
    });
  });

  it("contoh: categoryId di luar daftar Pengguna menolak status ok", () => {
    const result = validateNlResult(
      { type: "EXPENSE", amount: 12000, date: "2024-03-01", categoryId: "cat-asing" },
      { categories, todayWib: "2024-05-05" },
    );
    expect(result.status).toBe("needs_amount");
    if (result.status === "needs_amount") {
      expect(result.draft.categoryId).toBeUndefined();
    }
  });

  it("contoh: tanggal kosong atau salah format diganti todayWib", () => {
    const todayWib = "2024-05-05";
    for (const date of ["", "bukan-tanggal", "2024/03/01", "01-03-2024", undefined, 123]) {
      const result = validateNlResult(
        { type: "EXPENSE", amount: 12000, date, categoryId: "cat-makan" },
        { categories, todayWib },
      );
      // type+amount+categoryId valid -> status ok, tapi date harus todayWib.
      expect(result.status).toBe("ok");
      if (result.status === "ok") {
        expect(result.date).toBe(todayWib);
      }
    }
  });

  it("contoh: JSON rusak / teks acak menghasilkan needs_amount dengan draft", () => {
    const result = validateReceiptResult("{ ini bukan json", {
      categories,
      todayWib: "2024-05-05",
    });
    expect(result.status).toBe("needs_amount");
  });
});

describe("Property 15: Hasil AI tidak valid tidak pernah disimpan otomatis", () => {
  /**
   * Validates: Requirements 10.5, 10.6, 10.7, 11.4
   *
   * Keluaran non-object (JSON rusak, teks acak, primitif, array) selalu
   * menghasilkan needs_amount dengan draft bertanggal todayWib (tidak pernah ok).
   */
  it("properti: keluaran model non-object selalu needs_amount, bukan ok", () => {
    fc.assert(
      fc.property(nonObjectRaw, todayWibArb, (raw, todayWib) => {
        for (const result of [
          validateNlResult(raw, { categories, todayWib }),
          validateReceiptResult(raw, { categories, todayWib }),
        ]) {
          expect(result.status).toBe("needs_amount");
          if (result.status === "needs_amount") {
            expect(result.draft.date).toBe(todayWib);
          }
        }
      }),
    );
  });

  /**
   * Validates: Requirements 10.5
   *
   * Nominal hilang atau tidak valid tidak pernah menghasilkan status ok,
   * meski type dan categoryId valid (tidak ada Transaksi tersimpan otomatis).
   */
  it("properti: nominal hilang/tidak valid tidak pernah ok", () => {
    fc.assert(
      fc.property(
        invalidAmount,
        fc.constantFrom("EXPENSE", "INCOME"),
        fc.constantFrom(...categoryIds),
        todayWibArb,
        (amount, type, categoryId, todayWib) => {
          const raw = { type, amount, date: "2024-03-01", categoryId };
          expect(validateNlResult(raw, { categories, todayWib }).status).toBe("needs_amount");
          expect(validateReceiptResult(raw, { categories, todayWib }).status).toBe("needs_amount");
        },
      ),
    );
  });

  /**
   * Validates: Requirements 10.7, 11.4
   *
   * categoryId di luar daftar Pengguna tidak pernah menghasilkan ok, dan tidak
   * pernah muncul pada draft needs_amount.
   */
  it("properti: categoryId asing tidak pernah ok dan tidak bocor ke draft", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("EXPENSE", "INCOME"),
        validAmount,
        foreignCategoryId,
        validDate,
        todayWibArb,
        (type, amount, categoryId, date, todayWib) => {
          const raw = { type, amount, date, categoryId };
          for (const result of [
            validateNlResult(raw, { categories, todayWib }),
            validateReceiptResult(raw, { categories, todayWib }),
          ]) {
            expect(result.status).toBe("needs_amount");
            if (result.status === "needs_amount") {
              expect(result.draft.categoryId).toBeUndefined();
            }
          }
        },
      ),
    );
  });

  /**
   * Validates: Requirements 10.7
   *
   * type tidak valid tidak pernah menghasilkan ok.
   */
  it("properti: type tidak valid tidak pernah ok", () => {
    fc.assert(
      fc.property(
        invalidType,
        validAmount,
        fc.constantFrom(...categoryIds),
        validDate,
        todayWibArb,
        (type, amount, categoryId, date, todayWib) => {
          const raw = { type, amount, date, categoryId };
          expect(validateNlResult(raw, { categories, todayWib }).status).toBe("needs_amount");
          expect(validateReceiptResult(raw, { categories, todayWib }).status).toBe("needs_amount");
        },
      ),
    );
  });

  /**
   * Validates: Requirements 10.6
   *
   * Tanggal kosong atau tidak berformat YYYY-MM-DD selalu diganti todayWib,
   * baik pada hasil ok maupun pada draft needs_amount.
   */
  it("properti: tanggal tidak valid selalu diganti todayWib", () => {
    const invalidDate = fc.oneof(
      fc.constantFrom<unknown>("", "   ", "2024/03/01", "01-03-2024", "2024-3-1", null, undefined, 20240301),
      fc.string().filter((s) => !DATE_RE.test(s)),
    );
    fc.assert(
      fc.property(
        fc.constantFrom("EXPENSE", "INCOME"),
        validAmount,
        fc.constantFrom(...categoryIds),
        invalidDate,
        todayWibArb,
        (type, amount, categoryId, date, todayWib) => {
          const raw = { type, amount, date, categoryId };
          const nl = validateNlResult(raw, { categories, todayWib });
          const receipt = validateReceiptResult(raw, { categories, todayWib });
          // type+amount+categoryId valid, jadi statusnya ok, tetapi tanggal diganti.
          expect(nl.status).toBe("ok");
          if (nl.status === "ok") expect(nl.date).toBe(todayWib);
          expect(receipt.status).toBe("ok");
          if (receipt.status === "ok") expect(receipt.date).toBe(todayWib);
        },
      ),
    );
  });

  /**
   * Validates: Requirements 10.6
   *
   * Tanggal valid dipertahankan apa adanya.
   */
  it("properti: tanggal valid dipertahankan", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("EXPENSE", "INCOME"),
        validAmount,
        fc.constantFrom(...categoryIds),
        validDate,
        todayWibArb,
        (type, amount, categoryId, date, todayWib) => {
          const raw = { type, amount, date, categoryId };
          const result = validateNlResult(raw, { categories, todayWib });
          expect(result.status).toBe("ok");
          if (result.status === "ok") expect(result.date).toBe(date);
        },
      ),
    );
  });

  /**
   * Validates: Requirements 10.5, 10.6, 10.7, 11.4
   *
   * Hasil valid (ok) hanya terjadi bila type, amount, dan categoryId valid;
   * dan categoryId pada hasil ok selalu berasal dari daftar Pengguna.
   */
  it("properti: status ok menyiratkan seluruh field valid dan categoryId milik Pengguna", () => {
    const anyType = fc.oneof(fc.constantFrom<unknown>("EXPENSE", "INCOME"), invalidType);
    const anyAmount = fc.oneof(validAmount, invalidAmount);
    const anyCategoryId = fc.oneof(fc.constantFrom<unknown>(...categoryIds), foreignCategoryId, fc.constant(undefined));
    fc.assert(
      fc.property(anyType, anyAmount, anyCategoryId, validDate, todayWibArb, (type, amount, categoryId, date, todayWib) => {
        const raw = { type, amount, date, categoryId };
        const result = validateNlResult(raw, { categories, todayWib });
        if (result.status === "ok") {
          expect(type === "EXPENSE" || type === "INCOME").toBe(true);
          expect(Number.isInteger(amount) && (amount as number) > 0).toBe(true);
          expect(categoryIds).toContain(result.categoryId);
          expect(result.categoryId).toBe(categoryId);
        }
      }),
    );
  });

  /**
   * Validates: Requirements 11.4
   *
   * validateReceiptResult sepadan dengan validateNlResult pada status, type,
   * amount, date, dan categoryId; merchant hanya tambahan opsional.
   */
  it("properti: validateReceiptResult sepadan dengan validateNlResult plus merchant opsional", () => {
    const merchantArb = fc.oneof(fc.string(), fc.constant(undefined), fc.integer());
    fc.assert(
      fc.property(
        fc.oneof(fc.constantFrom<unknown>("EXPENSE", "INCOME"), invalidType),
        fc.oneof(validAmount, invalidAmount),
        fc.oneof(fc.constantFrom<unknown>(...categoryIds), foreignCategoryId),
        fc.oneof(validDate, fc.constant("")),
        merchantArb,
        todayWibArb,
        (type, amount, categoryId, date, merchant, todayWib) => {
          const raw = { type, amount, date, categoryId, merchant };
          const nl = validateNlResult(raw, { categories, todayWib });
          const receipt = validateReceiptResult(raw, { categories, todayWib });
          const { merchant: _m, ...receiptBase } = receipt as typeof receipt & { merchant?: string };
          expect(receiptBase).toEqual(nl);
          if (typeof merchant === "string" && merchant.trim()) {
            expect((receipt as { merchant?: string }).merchant).toBe(merchant);
          } else {
            expect((receipt as { merchant?: string }).merchant).toBeUndefined();
          }
        },
      ),
    );
  });
});
