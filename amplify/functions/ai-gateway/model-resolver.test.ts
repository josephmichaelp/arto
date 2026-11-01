import { beforeEach, describe, expect, it } from "vitest";
import fc from "fast-check";
import type { ModelCandidate } from "shared/config";
import {
  AI_MODEL_UNAVAILABLE,
  effectiveCandidates,
  isSwitchError,
  isTransientError,
  resetResolverState,
  resolveModel,
} from "./model-resolver";

function makeError(name: string, message = ""): Error {
  const err = new Error(message);
  err.name = name;
  return err;
}

beforeEach(() => {
  resetResolverState();
});

describe("isSwitchError", () => {
  it("contoh: AccessDeniedException memicu pindah", () => {
    expect(isSwitchError(makeError("AccessDeniedException"))).toBe(true);
  });

  it("contoh: ResourceNotFoundException memicu pindah", () => {
    expect(isSwitchError(makeError("ResourceNotFoundException"))).toBe(true);
  });

  it("contoh: ValidationException dengan pesan model tidak valid memicu pindah", () => {
    expect(
      isSwitchError(makeError("ValidationException", "The provided model identifier is invalid")),
    ).toBe(true);
    expect(
      isSwitchError(makeError("ValidationException", "inference profile not found for this account")),
    ).toBe(true);
  });

  it("contoh: ValidationException tanpa pesan model tidak valid TIDAK memicu pindah", () => {
    expect(
      isSwitchError(makeError("ValidationException", "Missing required field: amount")),
    ).toBe(false);
  });

  it("contoh: galat sementara TIDAK memicu pindah", () => {
    expect(isSwitchError(makeError("ThrottlingException"))).toBe(false);
    expect(isSwitchError(makeError("ServiceUnavailableException"))).toBe(false);
  });

  it("contoh: galat tanpa nama atau bukan objek TIDAK memicu pindah", () => {
    expect(isSwitchError(undefined)).toBe(false);
    expect(isSwitchError("bukan objek galat")).toBe(false);
    expect(isSwitchError({})).toBe(false);
  });
});

describe("isTransientError", () => {
  it("contoh: ThrottlingException, ServiceUnavailableException, dan TimeoutError bersifat sementara", () => {
    expect(isTransientError(makeError("ThrottlingException"))).toBe(true);
    expect(isTransientError(makeError("ServiceUnavailableException"))).toBe(true);
    expect(isTransientError(makeError("TimeoutError"))).toBe(true);
  });

  it("contoh: galat pindah kandidat TIDAK bersifat sementara", () => {
    expect(isTransientError(makeError("AccessDeniedException"))).toBe(false);
    expect(isTransientError(makeError("ResourceNotFoundException"))).toBe(false);
  });

  it("contoh: galat tanpa nama atau bukan objek galat TIDAK bersifat sementara", () => {
    expect(isTransientError(undefined)).toBe(false);
    expect(isTransientError({})).toBe(false);
  });
});

describe("effectiveCandidates", () => {
  const chain: ModelCandidate[] = [
    { modelId: "C1", region: "ap-southeast-3" },
    { modelId: "C2", region: "ap-southeast-3" },
    { modelId: "C3", region: "ap-southeast-1" },
  ];

  it("contoh: allowCrossRegion=true mengembalikan seluruh rantai", () => {
    expect(effectiveCandidates(chain, true)).toEqual(chain);
  });

  it("contoh: allowCrossRegion=false memaksa hanya kandidat pertama", () => {
    expect(effectiveCandidates(chain, false)).toEqual([chain[0]]);
  });

  /**
   * Property 25: Resolusi model memilih kandidat tersedia pertama (bagian effectiveCandidates)
   * Validates: Requirements 16.1
   */
  it("properti: allowCrossRegion=false selalu menghasilkan rantai sepanjang-panjangnya 1 berisi kandidat pertama", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ modelId: fc.string({ minLength: 1 }), region: fc.string({ minLength: 1 }) }), {
          minLength: 1,
          maxLength: 6,
        }),
        (candidates) => {
          const pool = effectiveCandidates(candidates, false);
          expect(pool).toEqual([candidates[0]]);
        },
      ),
    );
  });

  /**
   * Property 25: Resolusi model memilih kandidat tersedia pertama (bagian effectiveCandidates)
   * Validates: Requirements 16.1
   */
  it("properti: allowCrossRegion=true selalu mengembalikan rantai yang sama persis (tanpa mengubah urutan atau isi)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ modelId: fc.string(), region: fc.string() }), { maxLength: 6 }),
        (candidates) => {
          expect(effectiveCandidates(candidates, true)).toEqual(candidates);
        },
      ),
    );
  });
});

/**
 * Perilaku satu kandidat yang disimulasikan dalam pengujian `resolveModel`.
 *
 * - "ok": berhasil pada percobaan pertama.
 * - "switch": gagal dengan galat yang memicu pindah (mis. AccessDeniedException);
 *   rantai lanjut ke kandidat berikutnya.
 * - "transient-ok": gagal sementara pada percobaan pertama, berhasil pada percobaan ulang.
 * - "transient-fail": gagal sementara dua kali (percobaan ulang tetap gagal); rantai
 *   berhenti total karena galat akhir bukan galat pindah.
 * - "other-fail": gagal dengan galat lain yang bukan galat pindah maupun galat
 *   sementara; rantai berhenti total pada percobaan pertama.
 */
type Behavior = "ok" | "switch" | "transient-ok" | "transient-fail" | "other-fail";

const behaviorArb: fc.Arbitrary<Behavior> = fc.constantFrom(
  "ok",
  "switch",
  "transient-ok",
  "transient-fail",
  "other-fail",
);

const switchErrorFactories = [
  () => makeError("AccessDeniedException"),
  () => makeError("ResourceNotFoundException"),
  () => makeError("ValidationException", "the requested model is not supported"),
];

function behaviorChainArb() {
  return fc.array(behaviorArb, { minLength: 1, maxLength: 5 });
}

/** Membangun rantai kandidat dan fungsi `invoke` yang mengikuti `behaviors`. */
function buildHarness(behaviors: Behavior[]) {
  const candidates: ModelCandidate[] = behaviors.map((_, i) => ({
    modelId: `model-${i}`,
    region: "ap-southeast-3",
  }));
  const callCounts = new Array(behaviors.length).fill(0);

  const invoke = async (candidate: ModelCandidate): Promise<string> => {
    const index = Number(candidate.modelId.split("-")[1]);
    callCounts[index] += 1;
    const behavior = behaviors[index]!;
    const call = callCounts[index];

    switch (behavior) {
      case "ok":
        return `result-${index}`;
      case "switch":
        throw switchErrorFactories[index % switchErrorFactories.length]!();
      case "transient-ok":
        if (call === 1) throw makeError("ThrottlingException");
        return `result-${index}`;
      case "transient-fail":
        throw makeError("ThrottlingException");
      case "other-fail":
        throw makeError("SomeOtherDomainException", "galat tak terduga");
    }
  };

  return { candidates, callCounts, invoke };
}

/**
 * Menghitung hasil yang diharapkan dengan menyimulasikan aturan resolver
 * secara independen dari implementasi: pindah hanya untuk "switch", berhenti
 * total (tanpa mencoba kandidat berikutnya) untuk "transient-fail" dan
 * "other-fail", dan berhasil untuk "ok"/"transient-ok".
 */
function expectedOutcome(
  poolBehaviors: Behavior[],
): { type: "success"; index: number } | { type: "fail"; stopIndex: number } {
  for (let i = 0; i < poolBehaviors.length; i++) {
    const behavior = poolBehaviors[i]!;
    if (behavior === "ok" || behavior === "transient-ok") {
      return { type: "success", index: i };
    }
    if (behavior === "switch") {
      continue;
    }
    // "transient-fail" atau "other-fail": berhenti total di kandidat ini.
    return { type: "fail", stopIndex: i };
  }
  // Seluruh kandidat dalam pool adalah "switch": rantai habis.
  return { type: "fail", stopIndex: poolBehaviors.length - 1 };
}

describe("resolveModel - Property 25: Resolusi model memilih kandidat tersedia pertama", () => {
  it("contoh: kandidat pertama berhasil langsung dipakai, tanpa mencoba kandidat lain", async () => {
    const { candidates, callCounts, invoke } = buildHarness(["ok", "switch", "ok"]);
    const r = await resolveModel({ candidates, allowCrossRegion: true, invoke });
    expect(r.candidateIndex).toBe(0);
    expect(r.result).toBe("result-0");
    expect(callCounts[1]).toBe(0);
    expect(callCounts[2]).toBe(0);
  });

  it("contoh: AccessDeniedException pada C1 memindahkan ke C2", async () => {
    const { candidates, invoke } = buildHarness(["switch", "ok", "switch"]);
    const r = await resolveModel({ candidates, allowCrossRegion: true, invoke });
    expect(r.candidateIndex).toBe(1);
    expect(r.result).toBe("result-1");
  });

  it("contoh: galat sementara dicoba ulang sekali pada kandidat yang sama lalu berhasil", async () => {
    const { candidates, callCounts, invoke } = buildHarness(["transient-ok"]);
    const r = await resolveModel({ candidates, allowCrossRegion: true, invoke });
    expect(r.candidateIndex).toBe(0);
    expect(callCounts[0]).toBe(2);
  });

  it("contoh: galat sementara yang gagal lagi setelah percobaan ulang menghentikan rantai tanpa mencoba kandidat berikutnya", async () => {
    const { candidates, callCounts, invoke } = buildHarness(["transient-fail", "ok"]);
    await expect(resolveModel({ candidates, allowCrossRegion: true, invoke })).rejects.toMatchObject({
      code: AI_MODEL_UNAVAILABLE,
    });
    expect(callCounts[0]).toBe(2);
    expect(callCounts[1]).toBe(0);
  });

  it("contoh: AI_ALLOW_CROSS_REGION=false memaksa hanya C1 walau C2 tersedia", async () => {
    const { candidates, callCounts, invoke } = buildHarness(["switch", "ok"]);
    await expect(resolveModel({ candidates, allowCrossRegion: false, invoke })).rejects.toMatchObject({
      code: AI_MODEL_UNAVAILABLE,
    });
    expect(callCounts[1]).toBe(0);
  });

  it("contoh: seluruh kandidat gagal menghasilkan AI_MODEL_UNAVAILABLE", async () => {
    const { candidates, invoke } = buildHarness(["switch", "switch", "switch"]);
    await expect(resolveModel({ candidates, allowCrossRegion: true, invoke })).rejects.toMatchObject({
      name: "ModelUnavailableError",
      code: AI_MODEL_UNAVAILABLE,
    });
  });

  /**
   * Property 25: Resolusi model memilih kandidat tersedia pertama
   * Validates: Requirements 16.1
   */
  it("properti: untuk sembarang rantai dan pola ketersediaan, resolver memilih kandidat tersedia pertama menurut urutan, hanya pindah untuk galat yang ditentukan, mencoba ulang galat sementara sekali tanpa pindah, memaksa C1 bila AI_ALLOW_CROSS_REGION=false, dan menghasilkan AI_MODEL_UNAVAILABLE bila semua gagal", async () => {
    await fc.assert(
      fc.asyncProperty(behaviorChainArb(), fc.boolean(), async (behaviors, allowCrossRegion) => {
        resetResolverState();
        const { candidates, callCounts, invoke } = buildHarness(behaviors);
        const poolBehaviors = allowCrossRegion ? behaviors : behaviors.slice(0, 1);
        const expected = expectedOutcome(poolBehaviors);

        if (expected.type === "success") {
          const r = await resolveModel({ candidates, allowCrossRegion, invoke });
          expect(r.candidateIndex).toBe(expected.index);
          expect(r.result).toBe(`result-${expected.index}`);
          // Kandidat setelah titik berhasil tidak pernah dipanggil.
          for (let j = expected.index + 1; j < poolBehaviors.length; j++) {
            expect(callCounts[j]).toBe(0);
          }
        } else {
          await expect(resolveModel({ candidates, allowCrossRegion, invoke })).rejects.toMatchObject({
            code: AI_MODEL_UNAVAILABLE,
          });
          // Kandidat setelah titik berhenti total tidak pernah dipanggil.
          for (let j = expected.stopIndex + 1; j < poolBehaviors.length; j++) {
            expect(callCounts[j]).toBe(0);
          }
        }

        // Kandidat di luar pool efektif (dinonaktifkan oleh AI_ALLOW_CROSS_REGION=false) tidak pernah dipanggil.
        for (let j = poolBehaviors.length; j < behaviors.length; j++) {
          expect(callCounts[j]).toBe(0);
        }
      }),
    );
  });

  /**
   * Property 25: Resolusi model memilih kandidat tersedia pertama (indeks terpilih di memori modul)
   * Validates: Requirements 16.1
   */
  it("properti: setelah satu kandidat berhasil, permintaan berikutnya pada rantai yang sama mulai dari kandidat tersebut", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.boolean(), { minLength: 2, maxLength: 5 }),
        fc.integer({ min: 0, max: 4 }),
        async (okMask, rawWorkingIndex) => {
          resetResolverState();
          const workingIndex = rawWorkingIndex % okMask.length;
          // Pastikan kandidat pada workingIndex berhasil, lainnya bebas (akan diisi "switch" bila tidak berhasil).
          const behaviors: Behavior[] = okMask.map((ok, i) => (i === workingIndex || ok ? "ok" : "switch"));

          // Pemanggilan pertama: pastikan resolver mendarat di `workingIndex` dengan cara
          // membuat semua kandidat sebelum `workingIndex` gagal sementara (switch).
          const firstPassBehaviors: Behavior[] = behaviors.map((b, i) => (i < workingIndex ? "switch" : b));
          const first = buildHarness(firstPassBehaviors);
          const firstResult = await resolveModel({
            candidates: first.candidates,
            allowCrossRegion: true,
            invoke: first.invoke,
          });
          expect(firstResult.candidateIndex).toBe(workingIndex);

          // Pemanggilan kedua pada rantai yang sama (kandidat sama, termasuk yang sebelum
          // `workingIndex` kini diset berhasil juga): resolver harus mulai dari `workingIndex`
          // yang tersimpan di memori modul, bukan dari awal, sehingga kandidat sebelum
          // `workingIndex` tidak pernah dipanggil sama sekali.
          const second = buildHarness(behaviors);
          const secondResult = await resolveModel({
            candidates: second.candidates,
            allowCrossRegion: true,
            invoke: second.invoke,
          });
          expect(secondResult.candidateIndex).toBe(workingIndex);
          for (let j = 0; j < workingIndex; j++) {
            expect(second.callCounts[j]).toBe(0);
          }
        },
      ),
    );
  });
});
