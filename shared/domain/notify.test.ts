import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { notificationId, shouldCreate } from "./notify";
import type { NotifPrefs } from "./types";

/** Jenis Notifikasi yang dikendalikan oleh suatu kunci preferensi. */
const PREF_CONTROLLED_TYPES: Record<string, keyof NotifPrefs> = {
  budget80: "budget",
  over100: "budget",
  recrem: "recurring",
  "goal-done": "goal",
  insight: "insight",
};

const prefControlledTypeArb = fc.constantFrom(
  ...Object.keys(PREF_CONTROLLED_TYPES),
);

/** Jenis Notifikasi acak, termasuk jenis yang tidak terdaftar pada preferensi. */
const typeArb = fc.oneof(
  prefControlledTypeArb,
  fc.constantFrom("lainnya", "custom-type", ""),
);

const refArb = fc.string({ minLength: 1, maxLength: 20 });

/** `boolean | undefined` untuk setiap kunci preferensi. */
const prefFlagArb = fc.option(fc.boolean(), { nil: undefined });

const notifPrefsArb: fc.Arbitrary<NotifPrefs> = fc.record({
  budget: prefFlagArb,
  recurring: prefFlagArb,
  goal: prefFlagArb,
  insight: prefFlagArb,
});

const prefsOrNilArb = fc.oneof(
  notifPrefsArb,
  fc.constant(null),
  fc.constant(undefined),
);

describe("notificationId", () => {
  it("contoh: menghasilkan format `<type>:<ref>` sesuai dokumentasi", () => {
    expect(notificationId("budget80", "bud-1")).toBe("budget80:bud-1");
  });

  /**
   * Property 26: Notifikasi, penanda belum dibaca, dan preferensi
   * (bagian ID deterministik)
   * Validates: Requirements 9.1, 9.5
   */
  it("properti: deterministik untuk type dan ref yang sama, dan berbeda bila salah satunya berbeda", () => {
    fc.assert(
      fc.property(typeArb, refArb, typeArb, refArb, (type1, ref1, type2, ref2) => {
        expect(notificationId(type1, ref1)).toBe(notificationId(type1, ref1));

        if (type1 !== type2 || ref1 !== ref2) {
          expect(notificationId(type1, ref1)).not.toBe(notificationId(type2, ref2));
        }
      }),
    );
  });

  it("properti: id selalu memuat type dan ref dipisahkan oleh titik dua", () => {
    fc.assert(
      fc.property(prefControlledTypeArb, refArb, (type, ref) => {
        expect(notificationId(type, ref)).toBe(`${type}:${ref}`);
      }),
    );
  });
});

describe("shouldCreate - Property 26: Notifikasi, penanda belum dibaca, dan preferensi", () => {
  it("contoh: id yang sudah ada tidak boleh membuat Notifikasi ganda", () => {
    const id = notificationId("budget80", "bud-1");
    expect(shouldCreate("budget80", undefined, new Set([id]), id)).toBe(false);
  });

  it("contoh: jenis yang dinonaktifkan tidak dibuat meski id belum ada", () => {
    const id = notificationId("budget80", "bud-1");
    const prefs: NotifPrefs = { budget: false };
    expect(shouldCreate("budget80", prefs, new Set(), id)).toBe(false);
  });

  it("contoh: preferensi undefined dianggap diizinkan (bawaan aktif)", () => {
    const id = notificationId("insight", "2025-08-11");
    expect(shouldCreate("insight", {}, new Set(), id)).toBe(true);
  });

  it("contoh: jenis tanpa kunci preferensi terdaftar selalu diizinkan", () => {
    const id = notificationId("lainnya", "ref-1");
    const prefs: NotifPrefs = { budget: false, recurring: false, goal: false, insight: false };
    expect(shouldCreate("lainnya", prefs, new Set(), id)).toBe(true);
  });

  /**
   * Property 26: Notifikasi, penanda belum dibaca, dan preferensi
   * (bagian: id yang sama tidak membuat Notifikasi ganda)
   * Validates: Requirements 9.1
   */
  it("properti: id pada existingIds selalu menghasilkan false, apa pun preferensinya", () => {
    fc.assert(
      fc.property(typeArb, refArb, prefsOrNilArb, (type, ref, prefs) => {
        const id = notificationId(type, ref);
        expect(shouldCreate(type, prefs, new Set([id]), id)).toBe(false);
      }),
    );
  });

  /**
   * Property 26: Notifikasi, penanda belum dibaca, dan preferensi
   * (bagian: jenis yang dinonaktifkan tidak dibuat)
   * Validates: Requirements 9.5
   */
  it("properti: jenis dengan preferensi false pada kunci terkait selalu ditolak walau id belum ada", () => {
    fc.assert(
      fc.property(prefControlledTypeArb, refArb, (type, ref) => {
        const prefKey = PREF_CONTROLLED_TYPES[type];
        const prefs = Object.fromEntries([[prefKey, false]]) as NotifPrefs;
        const id = notificationId(type, ref);
        expect(shouldCreate(type, prefs, new Set(), id)).toBe(false);
      }),
    );
  });

  /**
   * Property 26: Notifikasi, penanda belum dibaca, dan preferensi
   * (bagian: diizinkan bila id baru dan preferensi tidak menonaktifkan)
   * Validates: Requirements 9.1, 9.5
   */
  it("properti: diizinkan ketika id belum ada dan preferensi terkait tidak false", () => {
    fc.assert(
      fc.property(typeArb, refArb, notifPrefsArb, (type, ref, prefs) => {
        const prefKey = PREF_CONTROLLED_TYPES[type];
        const disabled = prefKey != null && prefs[prefKey] === false;
        fc.pre(!disabled);

        const id = notificationId(type, ref);
        expect(shouldCreate(type, prefs, new Set(), id)).toBe(true);
      }),
    );
  });

  /**
   * Property 26: Notifikasi, penanda belum dibaca, dan preferensi
   * (bagian: hasil murni fungsi dari argumen, tanpa efek samping)
   * Validates: Requirements 9.1, 9.5
   */
  it("properti: shouldCreate bersifat murni (hasil sama untuk input sama, existingIds tidak berubah)", () => {
    fc.assert(
      fc.property(typeArb, refArb, prefsOrNilArb, fc.array(refArb), (type, ref, prefs, otherRefs) => {
        const id = notificationId(type, ref);
        const existingIds = new Set(otherRefs.map((r) => notificationId(type, r)));
        const snapshotBefore = new Set(existingIds);

        const first = shouldCreate(type, prefs, existingIds, id);
        const second = shouldCreate(type, prefs, existingIds, id);

        expect(second).toBe(first);
        expect(existingIds).toEqual(snapshotBefore);
      }),
    );
  });
});
