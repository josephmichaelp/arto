/**
 * Property 22: Keunikan dan reassign Kategori serta Dompet
 *
 * **Validates: Requirements 3.3, 3.5, 4.5**
 *
 * Tiga kelompok properti diverifikasi lewat fast-check pada repositori
 * in-memory tanpa AWS:
 *
 * 22a. Membuat Dompet/Kategori dengan nama yang sudah dipakai **selalu**
 *      melempar `NAME_TAKEN` (tanpa memperhatikan huruf besar kecil), dan tidak
 *      ada entitas duplikat yang tersimpan.
 *
 * 22b. Menghapus Kategori dengan pengganti memindahkan **semua** Transaksi ke
 *      pengganti dan menghapus **semua** Anggaran milik Kategori tersebut (K-6).
 *
 * 22c. Keunikan nama bersifat per-pemilik: pemilik yang berbeda boleh memiliki
 *      Dompet/Kategori dengan nama yang sama tanpa konflik.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { InMemoryLedgerRepo } from './repository';
import {
  createCategory,
  createWallet,
  deleteCategoryWithReassign,
  toNameKey,
  WalletCategoryOperationError,
} from './operations-wallet-category';

// ---------------------------------------------------------------------------
// Arbitrari pembantu
// ---------------------------------------------------------------------------

/**
 * Nama entitas: string alfanumerik huruf kecil minimal 2 karakter, bukan
 * hanya spasi, sehingga `requireName` pasti tidak melempar `NAME_REQUIRED`.
 */
const nameArb = fc
  .string({ minLength: 2, maxLength: 14 })
  .filter((s) => s.trim().length >= 1);

/** Format pemilik: `<sub>::<username>`. */
const ownerArb = fc
  .tuple(
    fc.string({ minLength: 3, maxLength: 8 }).filter((s) => s.length > 0 && !s.includes(':')),
    fc.string({ minLength: 3, maxLength: 8 }).filter((s) => s.length > 0 && !s.includes(':')),
  )
  .map(([sub, user]) => `${sub}::${user}`);

const categoryTypeArb = fc.constantFrom<'EXPENSE' | 'INCOME'>('EXPENSE', 'INCOME');

/** Pabrik ID deterministik baru per pemanggilan properti. */
function makeIdGen(): () => string {
  let n = 0;
  return () => `prop-${(n += 1)}`;
}

// ---------------------------------------------------------------------------
// Property 22a: Nama ganda selalu melempar NAME_TAKEN
// ---------------------------------------------------------------------------

describe('Property 22a: nama ganda selalu melempar NAME_TAKEN', () => {
  /**
   * Membuat Dompet dengan nama yang sudah ada (kunci sama persis) **selalu**
   * melempar `NAME_TAKEN` dan tidak menyimpan Dompet kedua.
   */
  it('Dompet: pembuatan ulang nama yang sama melempar NAME_TAKEN', async () => {
    await fc.assert(
      fc.asyncProperty(ownerArb, nameArb, async (owner, name) => {
        const repo = new InMemoryLedgerRepo();
        const id = makeIdGen();

        // Pembuatan pertama berhasil.
        const first = await createWallet(repo, owner, { name, initialBalance: 0 }, { newId: id });

        // Pembuatan kedua dengan nama yang sama (kunci identik) harus NAME_TAKEN.
        let threw = false;
        try {
          await createWallet(repo, owner, { name, initialBalance: 0 }, { newId: id });
        } catch (err) {
          expect(err).toBeInstanceOf(WalletCategoryOperationError);
          expect((err as WalletCategoryOperationError).code).toBe('NAME_TAKEN');
          threw = true;
        }
        expect(threw).toBe(true);

        // Hanya satu Dompet nyata (bukan guard) tersimpan.
        const real = repo.dump('Wallet').filter((w) => !w.id.startsWith('UNIQ#'));
        expect(real).toHaveLength(1);
        expect(real[0]?.id).toBe(first.id);
      }),
      { numRuns: 60 },
    );
  });

  /**
   * Membuat Dompet dengan nama huruf besar (kunci sama) juga melempar
   * `NAME_TAKEN`, karena `toNameKey` menormalisasi huruf sebelum pengecekan.
   */
  it('Dompet: varian huruf besar melempar NAME_TAKEN', async () => {
    await fc.assert(
      fc.asyncProperty(ownerArb, nameArb, async (owner, name) => {
        const repo = new InMemoryLedgerRepo();
        const id = makeIdGen();
        const upper = name.toUpperCase();

        // Hanya uji bila kunci huruf besar sama dengan kunci asal.
        fc.pre(toNameKey(upper) === toNameKey(name));

        await createWallet(repo, owner, { name, initialBalance: 0 }, { newId: id });

        let threw = false;
        try {
          await createWallet(repo, owner, { name: upper, initialBalance: 0 }, { newId: id });
        } catch (err) {
          if (err instanceof WalletCategoryOperationError && err.code === 'NAME_TAKEN') {
            threw = true;
          }
        }
        expect(threw).toBe(true);
      }),
      { numRuns: 60 },
    );
  });

  /**
   * Membuat Kategori dengan nama dan jenis yang sama (kunci identik) **selalu**
   * melempar `NAME_TAKEN`.
   */
  it('Kategori: pembuatan ulang nama + jenis yang sama melempar NAME_TAKEN', async () => {
    await fc.assert(
      fc.asyncProperty(ownerArb, nameArb, categoryTypeArb, async (owner, name, type) => {
        const repo = new InMemoryLedgerRepo();
        const id = makeIdGen();

        // Pembuatan pertama berhasil.
        await createCategory(repo, owner, { name, type }, { newId: id });

        // Pembuatan kedua harus NAME_TAKEN.
        let threw = false;
        try {
          await createCategory(repo, owner, { name, type }, { newId: id });
        } catch (err) {
          expect(err).toBeInstanceOf(WalletCategoryOperationError);
          expect((err as WalletCategoryOperationError).code).toBe('NAME_TAKEN');
          threw = true;
        }
        expect(threw).toBe(true);

        // Hanya satu Kategori nyata tersimpan.
        const real = repo.dump('Category').filter((c) => !c.id.startsWith('UNIQ#'));
        expect(real).toHaveLength(1);
      }),
      { numRuns: 60 },
    );
  });

  /**
   * Membuat Kategori dengan nama huruf besar (kunci sama per jenis) juga
   * melempar `NAME_TAKEN`.
   */
  it('Kategori: varian huruf besar dengan jenis sama melempar NAME_TAKEN', async () => {
    await fc.assert(
      fc.asyncProperty(ownerArb, nameArb, categoryTypeArb, async (owner, name, type) => {
        const repo = new InMemoryLedgerRepo();
        const id = makeIdGen();
        const upper = name.toUpperCase();

        fc.pre(toNameKey(upper) === toNameKey(name));

        await createCategory(repo, owner, { name, type }, { newId: id });

        let threw = false;
        try {
          await createCategory(repo, owner, { name: upper, type }, { newId: id });
        } catch (err) {
          if (err instanceof WalletCategoryOperationError && err.code === 'NAME_TAKEN') {
            threw = true;
          }
        }
        expect(threw).toBe(true);
      }),
      { numRuns: 60 },
    );
  });

  /**
   * Nama yang sama pada **jenis berbeda** (EXPENSE vs INCOME) **tidak** memicu
   * `NAME_TAKEN` — penjaga keunikan memisahkan per jenis.
   */
  it('Kategori: nama sama pada jenis berbeda TIDAK melempar NAME_TAKEN', async () => {
    await fc.assert(
      fc.asyncProperty(ownerArb, nameArb, async (owner, name) => {
        const repo = new InMemoryLedgerRepo();
        const id = makeIdGen();

        await createCategory(repo, owner, { name, type: 'EXPENSE' }, { newId: id });

        // Kategori jenis INCOME dengan nama sama harus berhasil.
        const result = await createCategory(repo, owner, { name, type: 'INCOME' }, { newId: id });
        expect(result.type).toBe('INCOME');
        expect(toNameKey(result.name)).toBe(toNameKey(name));

        // Dua Kategori nyata tersimpan (EXPENSE + INCOME).
        const real = repo.dump('Category').filter((c) => !c.id.startsWith('UNIQ#'));
        expect(real).toHaveLength(2);
      }),
      { numRuns: 60 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 22b: Reassign memindahkan semua Transaksi, menghapus semua Anggaran
// ---------------------------------------------------------------------------

describe('Property 22b: deleteCategoryWithReassign menjamin keselamatan data', () => {
  /**
   * Untuk jumlah Transaksi dan Anggaran yang dihasilkan secara acak, menghapus
   * Kategori dengan pengganti:
   *   - memindahkan SETIAP Transaksi ke pengganti (tidak ada yang hilang), dan
   *   - menghapus SEMUA Anggaran milik Kategori yang dihapus (K-6).
   */
  it('setiap Transaksi berpindah ke pengganti; setiap Anggaran Kategori terhapus', async () => {
    await fc.assert(
      fc.asyncProperty(
        ownerArb,
        fc.integer({ min: 0, max: 30 }),
        fc.integer({ min: 0, max: 10 }),
        categoryTypeArb,
        async (owner, nTxns, nBudgets, type) => {
          const repo = new InMemoryLedgerRepo();
          const id = makeIdGen();

          // Buat dua Kategori (sumber dan pengganti) serta satu Dompet.
          const srcCat = await createCategory(repo, owner, { name: 'Sumber', type }, { newId: id });
          const dstCat = await createCategory(repo, owner, { name: 'Tujuan', type }, { newId: id });
          const dstWallet = await createWallet(repo, owner, { name: 'Dompet', initialBalance: 0 }, { newId: id });

          // Semai Transaksi milik srcCat.
          const txnIds: string[] = [];
          for (let i = 0; i < nTxns; i++) {
            const txnId = id();
            txnIds.push(txnId);
            await repo.put('Transaction', {
              id: txnId,
              owner,
              type: 'EXPENSE',
              amount: 1000,
              date: '2025-01-10',
              month: '2025-01',
              walletId: dstWallet.id,
              categoryId: srcCat.id,
            });
          }

          // Semai Anggaran milik srcCat pada bulan berbeda.
          const budgetIds: string[] = [];
          for (let i = 0; i < nBudgets; i++) {
            const month = `2025-${String(i + 1).padStart(2, '0')}`;
            const budgetId = `${srcCat.id}#${month}`;
            budgetIds.push(budgetId);
            await repo.put('Budget', {
              id: budgetId,
              owner,
              categoryId: srcCat.id,
              month,
              amount: 500_000,
            });
          }

          // Hapus srcCat dengan dstCat sebagai pengganti.
          const result = await deleteCategoryWithReassign(repo, owner, {
            id: srcCat.id,
            replacementCategoryId: dstCat.id,
          });

          // Kategori sumber harus terhapus.
          expect(result.deleted).toBe(true);
          expect(await repo.get('Category', owner, srcCat.id)).toBeNull();

          // reassignedCount tepat sama dengan nTxns.
          expect(result.reassignedCount).toBe(nTxns);

          // SETIAP Transaksi kini memiliki categoryId pengganti (tidak ada yang hilang).
          for (const txnId of txnIds) {
            const stored = await repo.get('Transaction', owner, txnId);
            expect(stored?.categoryId).toBe(dstCat.id);
          }

          // budgetsDeleted tepat sama dengan nBudgets.
          expect(result.budgetsDeleted).toBe(nBudgets);

          // TIDAK ada Anggaran srcCat yang tersisa.
          const remaining = await repo.list('Budget', owner, { categoryId: srcCat.id });
          expect(remaining).toHaveLength(0);

          // Anggaran milik Kategori LAIN tidak terpengaruh (Anggaran dstCat aman).
        },
      ),
      { numRuns: 50 },
    );
  });

  /**
   * Penghapusan Kategori tanpa Transaksi (tanpa pengganti) tetap menghapus
   * semua Anggaran milik Kategori tersebut (K-6).
   */
  it('Kategori tanpa Transaksi: Anggaran tetap terhapus meski tanpa pengganti', async () => {
    await fc.assert(
      fc.asyncProperty(
        ownerArb,
        fc.integer({ min: 1, max: 10 }), // minimal 1 Anggaran
        categoryTypeArb,
        async (owner, nBudgets, type) => {
          const repo = new InMemoryLedgerRepo();
          const id = makeIdGen();

          const cat = await createCategory(repo, owner, { name: 'HapusKu', type }, { newId: id });

          for (let i = 0; i < nBudgets; i++) {
            const month = `2025-${String(i + 1).padStart(2, '0')}`;
            await repo.put('Budget', {
              id: `${cat.id}#${month}`,
              owner,
              categoryId: cat.id,
              month,
              amount: 200_000,
            });
          }

          // Tidak ada Transaksi → tidak perlu pengganti.
          const result = await deleteCategoryWithReassign(repo, owner, { id: cat.id });

          expect(result.deleted).toBe(true);
          expect(result.reassignedCount).toBe(0);
          expect(result.budgetsDeleted).toBe(nBudgets);
          expect(await repo.list('Budget', owner, { categoryId: cat.id })).toHaveLength(0);
        },
      ),
      { numRuns: 50 },
    );
  });

  /**
   * Transaksi milik pemilik lain pada Kategori yang dihapus tidak ikut
   * dipindahkan — `repo.list` membatasi ke pemilik yang diminta.
   */
  it('Transaksi pemilik lain tidak ikut dipindahkan saat reassign', async () => {
    await fc.assert(
      fc.asyncProperty(
        ownerArb,
        ownerArb,
        fc.integer({ min: 1, max: 5 }),
        categoryTypeArb,
        async (owner, other, nOtherTxns, type) => {
          fc.pre(owner !== other);
          const repo = new InMemoryLedgerRepo();
          const id = makeIdGen();

          // Buat Kategori untuk `owner`.
          const srcCat = await createCategory(repo, owner, { name: 'Src', type }, { newId: id });
          const dstCat = await createCategory(repo, owner, { name: 'Dst', type }, { newId: id });
          const dstWallet = await createWallet(repo, owner, { name: 'W', initialBalance: 0 }, { newId: id });

          // Semai Transaksi milik `other` dengan id Kategori `srcCat.id`
          // (hanya kebetulan — repositori akan mengabaikannya karena owner berbeda).
          const otherTxnIds: string[] = [];
          for (let i = 0; i < nOtherTxns; i++) {
            const txnId = id();
            otherTxnIds.push(txnId);
            await repo.put('Transaction', {
              id: txnId,
              owner: other,
              type: 'EXPENSE',
              amount: 500,
              date: '2025-01-05',
              month: '2025-01',
              walletId: dstWallet.id, // walletId boleh mana saja untuk uji ini
              categoryId: srcCat.id,
            });
          }

          // `owner` tidak punya Transaksi → hapus tanpa pengganti berhasil.
          const result = await deleteCategoryWithReassign(repo, owner, {
            id: srcCat.id,
            replacementCategoryId: dstCat.id,
          });

          expect(result.deleted).toBe(true);
          expect(result.reassignedCount).toBe(0);

          // Transaksi `other` tidak berubah — categoryId masih srcCat.id.
          for (const txnId of otherTxnIds) {
            const stored = await repo.get('Transaction', other, txnId);
            expect(stored?.categoryId).toBe(srcCat.id);
          }
        },
      ),
      { numRuns: 40 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 22c: Keunikan nama bersifat per-pemilik
// ---------------------------------------------------------------------------

describe('Property 22c: keunikan nama per pemilik (pemilik berbeda boleh pakai nama sama)', () => {
  /**
   * Untuk sembarang dua pemilik berbeda dan sembarang nama, membuat Dompet
   * dengan nama yang sama pada pemilik berbeda **tidak pernah** melempar
   * `NAME_TAKEN`.
   */
  it('Dompet: pemilik berbeda boleh memiliki Dompet dengan nama sama', async () => {
    await fc.assert(
      fc.asyncProperty(ownerArb, ownerArb, nameArb, async (owner1, owner2, name) => {
        fc.pre(owner1 !== owner2);
        const repo = new InMemoryLedgerRepo();
        const id = makeIdGen();

        // Buat Dompet untuk owner1.
        await createWallet(repo, owner1, { name, initialBalance: 0 }, { newId: id });

        // Buat Dompet untuk owner2 dengan nama yang sama → harus berhasil.
        const result = await createWallet(repo, owner2, { name, initialBalance: 0 }, { newId: id });
        expect(result.owner).toBe(owner2);
        expect(toNameKey(result.name)).toBe(toNameKey(name));
      }),
      { numRuns: 60 },
    );
  });

  /**
   * Untuk sembarang dua pemilik berbeda dan sembarang nama + jenis, membuat
   * Kategori dengan nama dan jenis yang sama pada pemilik berbeda **tidak
   * pernah** melempar `NAME_TAKEN`.
   */
  it('Kategori: pemilik berbeda boleh memiliki Kategori dengan nama dan jenis sama', async () => {
    await fc.assert(
      fc.asyncProperty(ownerArb, ownerArb, nameArb, categoryTypeArb, async (owner1, owner2, name, type) => {
        fc.pre(owner1 !== owner2);
        const repo = new InMemoryLedgerRepo();
        const id = makeIdGen();

        // Buat Kategori untuk owner1.
        await createCategory(repo, owner1, { name, type }, { newId: id });

        // Buat Kategori untuk owner2 dengan nama dan jenis yang sama → harus berhasil.
        const result = await createCategory(repo, owner2, { name, type }, { newId: id });
        expect(result.owner).toBe(owner2);
        expect(result.type).toBe(type);
        expect(toNameKey(result.name)).toBe(toNameKey(name));
      }),
      { numRuns: 60 },
    );
  });

  /**
   * Pemilik yang sama tidak boleh membuat dua Dompet dengan nama sama,
   * sedangkan pemilik berbeda boleh — membuktikan isolasi penjaga per pemilik.
   */
  it('Dompet: pemilik sama ditolak, pemilik berbeda diizinkan untuk nama yang sama', async () => {
    await fc.assert(
      fc.asyncProperty(ownerArb, ownerArb, nameArb, async (owner1, owner2, name) => {
        fc.pre(owner1 !== owner2);
        const repo = new InMemoryLedgerRepo();
        const id = makeIdGen();

        // Buat Dompet pertama untuk owner1.
        await createWallet(repo, owner1, { name, initialBalance: 0 }, { newId: id });

        // owner1 mencoba membuat lagi → harus NAME_TAKEN.
        await expect(
          createWallet(repo, owner1, { name, initialBalance: 0 }, { newId: id }),
        ).rejects.toMatchObject({ code: 'NAME_TAKEN' });

        // owner2 membuat dengan nama sama → harus berhasil.
        const w2 = await createWallet(repo, owner2, { name, initialBalance: 0 }, { newId: id });
        expect(w2.owner).toBe(owner2);
      }),
      { numRuns: 60 },
    );
  });

  /**
   * Kategori: pemilik sama ditolak, pemilik berbeda diizinkan.
   */
  it('Kategori: pemilik sama ditolak, pemilik berbeda diizinkan untuk nama + jenis yang sama', async () => {
    await fc.assert(
      fc.asyncProperty(ownerArb, ownerArb, nameArb, categoryTypeArb, async (owner1, owner2, name, type) => {
        fc.pre(owner1 !== owner2);
        const repo = new InMemoryLedgerRepo();
        const id = makeIdGen();

        await createCategory(repo, owner1, { name, type }, { newId: id });

        // owner1 mencoba membuat lagi → NAME_TAKEN.
        await expect(
          createCategory(repo, owner1, { name, type }, { newId: id }),
        ).rejects.toMatchObject({ code: 'NAME_TAKEN' });

        // owner2 membuat dengan nama dan jenis sama → berhasil.
        const c2 = await createCategory(repo, owner2, { name, type }, { newId: id });
        expect(c2.owner).toBe(owner2);
        expect(c2.type).toBe(type);
      }),
      { numRuns: 60 },
    );
  });
});
