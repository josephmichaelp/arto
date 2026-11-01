/**
 * Property 9: Notifikasi ambang anggaran sekali per bulan
 *
 * **Validates: Requirements 5.4, 5.5**
 *
 * Tiga properti universal diverifikasi memakai fast-check pada
 * {@link evaluateBudgetThresholds} dengan repositori in-memory (tanpa
 * jaringan/AWS):
 *
 * 1. **Biconditional threshold** — `budget80` dibuat tepat saat
 *    `spent * 100 >= amount * 80`; `over100` dibuat tepat saat
 *    `spent > amount`. Tidak ada Notifikasi palsu positif maupun palsu
 *    negatif untuk sembarang kombinasi `amount` dan `spent`.
 *
 * 2. **Idempoten / tidak pernah ganda** — memanggil evaluator dua kali pada
 *    repositori yang sama tidak pernah menghasilkan lebih dari satu Notifikasi
 *    per jenis per Anggaran, karena penanda `warn80Sent`/`over100Sent`
 *    mencegah pembuatan ulang (lapis pertama), diperkuat oleh prasyarat
 *    `attribute_not_exists` pada penulisan Notifikasi (lapis kedua).
 *
 * 3. **Preferensi `budget=false`** — saat `NotifPrefs.budget=false`,
 *    tidak ada Notifikasi yang tersimpan di repositori meski ambang sudah
 *    terlampaui. Penanda tetap diset agar ambang yang terlampaui tidak
 *    dievaluasi ulang bila preferensi diaktifkan kembali.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  BUDGET_OVER_TYPE,
  BUDGET_WARN_TYPE,
  evaluateBudgetThresholds,
} from './notifications';
import { InMemoryLedgerRepo, type ItemRecord } from './repository';

// ---------------------------------------------------------------------------
// Konstanta dan helper generator
// ---------------------------------------------------------------------------

const OWNER = 'sub-prop9::user-prop9';
const CAT_ID = 'cat-prop9';
const BUDGET_ID = 'b-prop9';
const MONTH = '2025-07';

/**
 * Nominal Anggaran positif (bilangan bulat >= 1) agar tidak ada pembagian
 * dengan nol dan sesuai Requirement 5.1 ("nominal lebih dari 0").
 */
const amountArb = fc.integer({ min: 1, max: 10_000_000 });

/**
 * Total pengeluaran yang dapat mencapai 200 % dari anggaran maksimum, sehingga
 * generator menjangkau empat kuadran: belum-80 %, 80–100 %, tepat-100 %, dan
 * melebihi-100 %.
 */
const spentArb = fc.integer({ min: 0, max: 20_000_000 });

/**
 * Membangun repositori in-memory berisi satu Anggaran (`amount`) dan satu
 * Transaksi EXPENSE (`spent`) pada `MONTH` untuk `CAT_ID`.
 * Bila `spent = 0` tidak ada Transaksi sehingga `monthlySpent` mengembalikan 0.
 */
function makeRepo(amount: number, spent: number): InMemoryLedgerRepo {
  const budget: ItemRecord = {
    id: BUDGET_ID,
    owner: OWNER,
    categoryId: CAT_ID,
    month: MONTH,
    amount,
    // Tanpa warn80Sent/over100Sent → evaluasi pertama boleh membuat Notifikasi.
  };

  const txns: ItemRecord[] = [];
  if (spent > 0) {
    txns.push({
      id: 't-prop9',
      owner: OWNER,
      type: 'EXPENSE',
      amount: spent,
      date: `${MONTH}-15`,
      month: MONTH,
      categoryId: CAT_ID,
      walletId: 'w-prop9',
    });
  }

  return new InMemoryLedgerRepo({ Budget: [budget], Transaction: txns });
}

// ---------------------------------------------------------------------------
// Property 9a: biconditional — Notifikasi dibuat TEPAT saat ambang terlampaui
// ---------------------------------------------------------------------------

describe('Property 9: biconditional threshold (budget80 dan over100)', () => {
  /**
   * Untuk sembarang (amount >= 1, spent >= 0), `evaluateBudgetThresholds`
   * melaporkan `warn80=true` tepat saat `spent * 100 >= amount * 80` (kriteria
   * perbandingan bilangan bulat tanpa float, Req 5.4) dan menyimpan Notifikasi
   * `budget80:<budgetId>` di repositori tepat saat `warn80=true`.
   */
  it('properti: budget80 dilaporkan dan disimpan tepat saat spent * 100 >= amount * 80', async () => {
    await fc.assert(
      fc.asyncProperty(amountArb, spentArb, async (amount, spent) => {
        const expectedWarn80 = spent * 100 >= amount * 80;
        const repo = makeRepo(amount, spent);

        const res = await evaluateBudgetThresholds(
          repo,
          OWNER,
          { categoryId: CAT_ID, month: MONTH },
          null,
        );

        expect(res.evaluated).toBe(true);
        expect(res.warn80).toBe(expectedWarn80);

        const storedNotif = await repo.get('Notification', OWNER, `${BUDGET_WARN_TYPE}:${BUDGET_ID}`);
        expect(storedNotif !== null).toBe(expectedWarn80);

        if (expectedWarn80) {
          expect(res.flagsSet).toContain('warn80Sent');
          const budgetAfter = await repo.get('Budget', OWNER, BUDGET_ID);
          expect(budgetAfter?.warn80Sent).toBe(true);
        }
      }),
    );
  });

  /**
   * Untuk sembarang (amount >= 1, spent >= 0), `evaluateBudgetThresholds`
   * melaporkan `over100=true` tepat saat `spent > amount` (Req 5.5) dan
   * menyimpan Notifikasi `over100:<budgetId>` tepat saat `over100=true`.
   */
  it('properti: over100 dilaporkan dan disimpan tepat saat spent > amount', async () => {
    await fc.assert(
      fc.asyncProperty(amountArb, spentArb, async (amount, spent) => {
        const expectedOver100 = spent > amount;
        const repo = makeRepo(amount, spent);

        const res = await evaluateBudgetThresholds(
          repo,
          OWNER,
          { categoryId: CAT_ID, month: MONTH },
          null,
        );

        expect(res.evaluated).toBe(true);
        expect(res.over100).toBe(expectedOver100);

        const storedNotif = await repo.get('Notification', OWNER, `${BUDGET_OVER_TYPE}:${BUDGET_ID}`);
        expect(storedNotif !== null).toBe(expectedOver100);

        if (expectedOver100) {
          expect(res.flagsSet).toContain('over100Sent');
          const budgetAfter = await repo.get('Budget', OWNER, BUDGET_ID);
          expect(budgetAfter?.over100Sent).toBe(true);
        }
      }),
    );
  });

  /**
   * Kasus batas: tepat di ambang 80 persen (spent * 100 === amount * 80) harus
   * menghasilkan `warn80=true`, tetapi `over100=false` bila `spent <= amount`.
   * Kasus ini paling rentan menghasilkan kekeliruan off-by-one.
   */
  it('properti: tepat di ambang 80 persen selalu menghasilkan warn80=true', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Pilih amount yang merupakan kelipatan 5 agar spent = amount*80/100
        // selalu bilangan bulat.
        fc.integer({ min: 5, max: 2_000_000 }).filter((n) => n % 5 === 0),
        async (amount) => {
          // spent = (amount * 80 / 100) dijamin bilangan bulat.
          const spent = (amount * 80) / 100;
          const repo = makeRepo(amount, spent);

          const res = await evaluateBudgetThresholds(
            repo,
            OWNER,
            { categoryId: CAT_ID, month: MONTH },
            null,
          );

          // Ambang bawah: tepat 80 % → warn80 harus true.
          expect(res.warn80).toBe(true);
          // Tepat 80 % belum melampaui 100 % selama amount > 0.
          expect(res.over100).toBe(false);
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// Property 9b: idempoten — tidak pernah ganda meski evaluator dipanggil berkali
// ---------------------------------------------------------------------------

describe('Property 9: idempoten — Notifikasi tidak pernah dibuat ganda', () => {
  /**
   * Memanggil `evaluateBudgetThresholds` dua kali berturut-turut pada repositori
   * yang sama tidak boleh menghasilkan lebih dari satu Notifikasi per jenis per
   * Anggaran, untuk sembarang (amount, spent). Jaminan berlapis:
   * - Penanda `warn80Sent`/`over100Sent` mencegah pembuatan ulang (lapis 1).
   * - Prasyarat `attribute_not_exists(id)` pada penulisan Notifikasi (lapis 2).
   */
  it('properti: dua pemanggilan evaluator menghasilkan paling banyak satu Notifikasi per jenis', async () => {
    await fc.assert(
      fc.asyncProperty(amountArb, spentArb, async (amount, spent) => {
        const repo = makeRepo(amount, spent);

        // Panggilan pertama.
        const res1 = await evaluateBudgetThresholds(
          repo,
          OWNER,
          { categoryId: CAT_ID, month: MONTH },
          null,
        );

        // Panggilan kedua — repositori yang sama, Anggaran sudah memiliki
        // penanda yang diset oleh panggilan pertama (bila ambang terlampaui).
        const res2 = await evaluateBudgetThresholds(
          repo,
          OWNER,
          { categoryId: CAT_ID, month: MONTH },
          null,
        );

        // Panggilan kedua tidak boleh menambah penanda atau Notifikasi baru.
        expect(res2.flagsSet).toHaveLength(0);
        expect(res2.notifications).toHaveLength(0);

        // Total Notifikasi di repositori tidak boleh melebihi jumlah jenis ambang.
        const allNotifs = await repo.list('Notification', OWNER);
        const warn80Count = allNotifs.filter((n) => n.type === BUDGET_WARN_TYPE).length;
        const over100Count = allNotifs.filter((n) => n.type === BUDGET_OVER_TYPE).length;
        expect(warn80Count).toBeLessThanOrEqual(1);
        expect(over100Count).toBeLessThanOrEqual(1);

        // Nilai threshold konsisten antara kedua panggilan.
        expect(res2.warn80).toBe(res1.warn80);
        expect(res2.over100).toBe(res1.over100);
      }),
    );
  });

  /**
   * Mengkhususkan kasus `spent` yang melampaui ambang 80 persen: panggilan
   * kedua harus melaporkan `flagsSet` kosong karena penanda sudah diset pada
   * panggilan pertama.
   */
  it('properti: panggilan kedua setelah ambang 80 persen terlampaui tidak menyentuh penanda', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Pilih amount dan spent sedemikian rupa sehingga pasti melampaui 80 %.
        amountArb,
        amountArb.map((a) => Math.ceil((a * 80) / 100)), // spent = ceil(80 %)
        async (amount, spent) => {
          // Pastikan kondisi terpenuhi (untuk mencegah floating-point edge pada map).
          fc.pre(spent * 100 >= amount * 80);

          const repo = makeRepo(amount, spent);

          await evaluateBudgetThresholds(repo, OWNER, { categoryId: CAT_ID, month: MONTH }, null);
          const res2 = await evaluateBudgetThresholds(
            repo,
            OWNER,
            { categoryId: CAT_ID, month: MONTH },
            null,
          );

          expect(res2.flagsSet).toHaveLength(0);
          expect(res2.notifications).toHaveLength(0);
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// Property 9c: preferensi — budget=false mencegah penyimpanan Notifikasi
// ---------------------------------------------------------------------------

describe('Property 9: preferensi NotifPrefs.budget=false', () => {
  /**
   * Bila `NotifPrefs.budget=false`, `evaluateBudgetThresholds` tidak menyimpan
   * satu pun Notifikasi ke repositori, meski ambang sudah terlampaui. Penanda
   * `warn80Sent`/`over100Sent` TETAP diset agar ambang yang terlampaui tidak
   * dievaluasi ulang bila preferensi diaktifkan kembali (perilaku yang
   * didokumentasikan dalam kode sumber).
   */
  it('properti: budget=false menekan semua Notifikasi ambang meski ambang terlampaui', async () => {
    await fc.assert(
      fc.asyncProperty(amountArb, spentArb, async (amount, spent) => {
        const repo = makeRepo(amount, spent);

        const res = await evaluateBudgetThresholds(
          repo,
          OWNER,
          { categoryId: CAT_ID, month: MONTH },
          { budget: false },
        );

        // Tidak ada Notifikasi yang tersimpan.
        const allNotifs = await repo.list('Notification', OWNER);
        expect(allNotifs).toHaveLength(0);

        // Setiap Notifikasi yang diproses harus berstatus `created=false`.
        for (const n of res.notifications) {
          expect(n.result.created).toBe(false);
          expect(n.result.reason).toBe('prefs-disabled');
        }
      }),
    );
  });

  /**
   * Bila `NotifPrefs.budget=false` dan ambang 80 persen terlampaui, penanda
   * `warn80Sent` tetap diset pada Anggaran sehingga evaluasi ulang setelah
   * preferensi diaktifkan kembali tidak membuat Notifikasi yang "terlambat".
   */
  it('properti: budget=false tetap menyebabkan flagsSet terisi bila ambang terlampaui', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Pilih kasus yang pasti melampaui ambang 80 persen.
        amountArb,
        amountArb, // spent akan di-map menjadi 2× amount (pasti over100)
        async (amount, multiplier) => {
          // spent = amount + multiplier memastikan over100 pasti terjadi.
          const spent = amount + multiplier;
          const repo = makeRepo(amount, spent);

          const res = await evaluateBudgetThresholds(
            repo,
            OWNER,
            { categoryId: CAT_ID, month: MONTH },
            { budget: false },
          );

          // Ambang pasti terlampaui (spent > amount dan spent * 100 > amount * 80).
          expect(res.warn80).toBe(true);
          expect(res.over100).toBe(true);

          // Penanda harus tetap diset meski Notifikasi tidak dibuat.
          expect(res.flagsSet).toContain('warn80Sent');
          expect(res.flagsSet).toContain('over100Sent');
          const budgetAfter = await repo.get('Budget', OWNER, BUDGET_ID);
          expect(budgetAfter?.warn80Sent).toBe(true);
          expect(budgetAfter?.over100Sent).toBe(true);

          // Namun tidak ada Notifikasi tersimpan.
          const allNotifs = await repo.list('Notification', OWNER);
          expect(allNotifs).toHaveLength(0);
        },
      ),
    );
  });

  /**
   * Setelah satu evaluasi dengan `budget=false` (yang menyebabkan penanda
   * diset), mengaktifkan kembali preferensi dan memanggil evaluator lagi
   * tidak boleh membuat Notifikasi baru karena penanda sudah diset.
   */
  it('properti: setelah budget=false, mengaktifkan kembali preferensi tidak membuat Notifikasi baru', async () => {
    await fc.assert(
      fc.asyncProperty(
        amountArb,
        amountArb, // dipakai sebagai offset agar pasti over100
        async (amount, extra) => {
          const spent = amount + extra; // pasti over100
          const repo = makeRepo(amount, spent);

          // Evaluasi dengan preferensi dinonaktifkan → penanda diset, tanpa Notifikasi.
          await evaluateBudgetThresholds(
            repo,
            OWNER,
            { categoryId: CAT_ID, month: MONTH },
            { budget: false },
          );

          // Evaluasi ulang dengan preferensi aktif kembali.
          const res2 = await evaluateBudgetThresholds(
            repo,
            OWNER,
            { categoryId: CAT_ID, month: MONTH },
            null, // preferensi aktif
          );

          // Penanda sudah diset → tidak ada Notifikasi baru.
          expect(res2.flagsSet).toHaveLength(0);
          expect(res2.notifications).toHaveLength(0);
          const allNotifs = await repo.list('Notification', OWNER);
          expect(allNotifs).toHaveLength(0);
        },
      ),
    );
  });
});
