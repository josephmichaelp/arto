import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { DEFAULT_AI_RATE_LIMIT, decideRate, hourBucket } from "./rate-limit";

/** Arbitrary instan sebagai timestamp ms, dari tahun 1970 sampai 2100. */
const instantArb = fc
  .integer({ min: 0, max: Date.UTC(2100, 0, 1) })
  .map((ms) => new Date(ms));

/** Arbitrary batas pemakaian positif yang wajar. */
const limitArb = fc.integer({ min: 1, max: 1000 });

describe("hourBucket", () => {
  it("contoh: dua instan pada jam UTC yang sama menghasilkan kunci yang sama", () => {
    expect(hourBucket(new Date("2025-08-17T14:00:00.000Z"))).toBe(
      hourBucket(new Date("2025-08-17T14:59:59.999Z")),
    );
  });

  it("contoh: format kunci sesuai contoh pada dokumentasi", () => {
    expect(hourBucket(new Date("2025-08-17T14:23:45.000Z"))).toBe(
      "2025-08-17T14",
    );
  });

  it("contoh: tepat pukul 15:00:00.000 UTC sudah masuk jendela jam berikutnya", () => {
    expect(hourBucket(new Date("2025-08-17T15:00:00.000Z"))).toBe(
      "2025-08-17T15",
    );
  });

  it("contoh: melempar galat untuk instan tidak valid", () => {
    expect(() => hourBucket(new Date("tidak-valid"))).toThrow();
  });

  /**
   * Property 23: Pembatas pemakaian AI (bagian hourBucket)
   * Validates: Requirements 16.3
   */
  it("properti: hourBucket sama untuk dua instan pada jam UTC yang sama, dan berbeda pada jam UTC berikutnya", () => {
    fc.assert(
      fc.property(instantArb, fc.integer({ min: 0, max: 3_599_999 }), (instant, offsetMs) => {
        // Mundurkan ke awal jam UTC, lalu geser dalam rentang jam yang sama.
        const startOfHour = new Date(instant);
        startOfHour.setUTCMinutes(0, 0, 0);
        const within = new Date(startOfHour.getTime() + offsetMs);

        expect(hourBucket(within)).toBe(hourBucket(startOfHour));

        const nextHour = new Date(startOfHour.getTime() + 60 * 60 * 1000);
        expect(hourBucket(nextHour)).not.toBe(hourBucket(startOfHour));
      }),
    );
  });
});

describe("decideRate - Property 23: Pembatas pemakaian AI", () => {
  it("contoh: permintaan ke-30 (default) masih diizinkan", () => {
    expect(decideRate(30)).toEqual({ allowed: true });
  });

  it("contoh: permintaan ke-31 (default) ditolak dengan pesan berbahasa Indonesia", () => {
    const decision = decideRate(31);
    expect(decision.allowed).toBe(false);
    expect(decision.message).toBe(
      "Batas pemakaian AI tercapai (30 permintaan per jam). Coba lagi pada jam berikutnya.",
    );
  });

  it("contoh: hitungan memakai batas default bila limit tidak diberikan", () => {
    expect(decideRate(DEFAULT_AI_RATE_LIMIT).allowed).toBe(true);
    expect(decideRate(DEFAULT_AI_RATE_LIMIT + 1).allowed).toBe(false);
  });

  /**
   * Property 23: Pembatas pemakaian AI
   * Validates: Requirements 16.3
   */
  it("properti: untuk urutan permintaan 1..N dalam satu hourBucket, tepat `limit` permintaan pertama diizinkan dan sisanya ditolak dengan pesan", () => {
    fc.assert(
      fc.property(limitArb, fc.integer({ min: 1, max: 200 }), (limit, totalRequests) => {
        const decisions = Array.from({ length: totalRequests }, (_, i) =>
          decideRate(i + 1, limit),
        );

        decisions.forEach((decision, i) => {
          const count = i + 1;
          if (count <= limit) {
            expect(decision).toEqual({ allowed: true });
          } else {
            expect(decision.allowed).toBe(false);
            expect(typeof decision.message).toBe("string");
            expect(decision.message).toContain(String(limit));
          }
        });
      }),
    );
  });

  /**
   * Property 23: Pembatas pemakaian AI
   * Validates: Requirements 16.3
   */
  it("properti: pada hourBucket berikutnya, hitungan dimulai dari nol sehingga permintaan pertama selalu diizinkan", () => {
    fc.assert(
      fc.property(limitArb, instantArb, (limit, instant) => {
        // Habiskan batas pada jam ini...
        const lastAllowedInCurrentHour = decideRate(limit, limit);
        expect(lastAllowedInCurrentHour.allowed).toBe(true);
        const firstRejectedInCurrentHour = decideRate(limit + 1, limit);
        expect(firstRejectedInCurrentHour.allowed).toBe(false);

        // ...pada hourBucket berikutnya, hitungan kembali dari 1 dan selalu diizinkan.
        const nextHourInstant = new Date(instant.getTime() + 60 * 60 * 1000);
        expect(hourBucket(nextHourInstant)).not.toBe(hourBucket(instant));
        const firstInNextHour = decideRate(1, limit);
        expect(firstInNextHour).toEqual({ allowed: true });
      }),
    );
  });

  /**
   * Property 23: Pembatas pemakaian AI
   * Validates: Requirements 16.3
   */
  it("properti: decideRate tidak memiliki efek samping, hasilnya murni fungsi dari count dan limit", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 500 }),
        limitArb,
        (count, limit) => {
          const first = decideRate(count, limit);
          const second = decideRate(count, limit);
          expect(second).toEqual(first);
        },
      ),
    );
  });
});
