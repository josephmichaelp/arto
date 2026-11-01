import { describe, expect, it } from 'vitest';
import { InMemoryLedgerRepo, type ItemRecord } from './repository';
import {
  categoryGuardId,
  createCategory,
  createWallet,
  deleteCategoryWithReassign,
  deleteWalletWithReassign,
  renameCategory,
  renameWallet,
  toNameKey,
  WalletCategoryOperationError,
  walletGuardId,
} from './operations-wallet-category';

const OWNER = 'sub-a::user-a';
const OTHER = 'sub-b::user-b';

/** Pembuat ID deterministik untuk uji. */
function sequentialIds(prefix = 'id'): () => string {
  let n = 0;
  return () => `${prefix}-${(n += 1)}`;
}

function wallet(id: string, owner: string, name: string, balance: number): ItemRecord {
  return { id, owner, name, nameKey: toNameKey(name), initialBalance: balance, balance };
}

function category(id: string, owner: string, name: string, type: 'EXPENSE' | 'INCOME'): ItemRecord {
  return { id, owner, name, nameKey: toNameKey(name), type };
}

function txn(id: string, owner: string, extra: Record<string, unknown>): ItemRecord {
  return {
    id,
    owner,
    type: 'EXPENSE',
    amount: 100,
    date: '2025-01-10',
    month: '2025-01',
    ...extra,
  } as ItemRecord;
}

/** Menyaring item penjaga `UNIQ#...` dari daftar entitas. */
function realOnly<T extends { id: string }>(items: readonly T[]): T[] {
  return items.filter((i) => !i.id.startsWith('UNIQ#'));
}

// --- Dompet ---------------------------------------------------------------

describe('createWallet', () => {
  it('menyimpan Dompet baru dengan saldo awal dan item penjaga keunikan', async () => {
    const repo = new InMemoryLedgerRepo();
    const result = await createWallet(
      repo,
      OWNER,
      { name: 'Bank BCA', initialBalance: 5000 },
      { newId: sequentialIds('w') },
    );

    expect(result.id).toBe('w-1');
    expect(result.balance).toBe(5000);
    expect(result.nameKey).toBe('bank bca');
    expect(await repo.get('Wallet', OWNER, 'w-1')).toMatchObject({ name: 'Bank BCA', balance: 5000 });
    // Item penjaga keunikan tertulis.
    expect(repo.dump('Wallet').some((w) => w.id === walletGuardId(OWNER, 'bank bca'))).toBe(true);
  });

  it('menolak nama ganda tanpa membedakan huruf besar kecil dan spasi tepi', async () => {
    const repo = new InMemoryLedgerRepo();
    await createWallet(repo, OWNER, { name: 'Tunai', initialBalance: 0 }, { newId: sequentialIds('w') });
    await expect(
      createWallet(repo, OWNER, { name: '  tunai  ', initialBalance: 0 }, { newId: sequentialIds('x') }),
    ).rejects.toMatchObject({ code: 'NAME_TAKEN', message: 'Nama sudah dipakai' });
    // Hanya satu Dompet nyata tersimpan.
    expect(realOnly(repo.dump('Wallet'))).toHaveLength(1);
  });

  it('mengizinkan nama sama pada pemilik berbeda', async () => {
    const repo = new InMemoryLedgerRepo();
    await createWallet(repo, OWNER, { name: 'Tunai', initialBalance: 0 }, { newId: sequentialIds('a') });
    await expect(
      createWallet(repo, OTHER, { name: 'Tunai', initialBalance: 0 }, { newId: sequentialIds('b') }),
    ).resolves.toMatchObject({ owner: OTHER });
  });

  it('menolak saldo awal negatif atau bukan bilangan bulat', async () => {
    const repo = new InMemoryLedgerRepo();
    await expect(
      createWallet(repo, OWNER, { name: 'A', initialBalance: -1 }),
    ).rejects.toMatchObject({ code: 'INITIAL_BALANCE_INVALID' });
    await expect(
      createWallet(repo, OWNER, { name: 'B', initialBalance: 10.5 }),
    ).rejects.toMatchObject({ code: 'INITIAL_BALANCE_INVALID' });
  });

  it('menolak nama kosong', async () => {
    const repo = new InMemoryLedgerRepo();
    await expect(
      createWallet(repo, OWNER, { name: '   ', initialBalance: 0 }),
    ).rejects.toMatchObject({ code: 'NAME_REQUIRED' });
  });
});

describe('renameWallet', () => {
  it('mengganti nama dan memindahkan item penjaga keunikan', async () => {
    const repo = new InMemoryLedgerRepo({
      Wallet: [wallet('w1', OWNER, 'Bank', 100), { id: walletGuardId(OWNER, 'bank'), owner: OWNER }],
    });
    const result = await renameWallet(repo, OWNER, { id: 'w1', name: 'Bank Mandiri' });

    expect(result.name).toBe('Bank Mandiri');
    expect(result.nameKey).toBe('bank mandiri');
    const guards = repo.dump('Wallet').filter((w) => w.id.startsWith('UNIQ#'));
    expect(guards.map((g) => g.id)).toEqual([walletGuardId(OWNER, 'bank mandiri')]);
  });

  it('mengizinkan perubahan huruf besar kecil tanpa menyentuh penjaga', async () => {
    const repo = new InMemoryLedgerRepo({
      Wallet: [wallet('w1', OWNER, 'bank', 100), { id: walletGuardId(OWNER, 'bank'), owner: OWNER }],
    });
    const result = await renameWallet(repo, OWNER, { id: 'w1', name: 'Bank' });
    expect(result.name).toBe('Bank');
    expect(result.nameKey).toBe('bank');
  });

  it('menolak ganti nama menjadi nama yang sudah dipakai', async () => {
    const repo = new InMemoryLedgerRepo({
      Wallet: [
        wallet('w1', OWNER, 'Bank', 100),
        { id: walletGuardId(OWNER, 'bank'), owner: OWNER },
        wallet('w2', OWNER, 'Tunai', 0),
        { id: walletGuardId(OWNER, 'tunai'), owner: OWNER },
      ],
    });
    await expect(
      renameWallet(repo, OWNER, { id: 'w1', name: 'Tunai' }),
    ).rejects.toMatchObject({ code: 'NAME_TAKEN' });
    // Nama w1 tidak berubah.
    expect((await repo.get('Wallet', OWNER, 'w1'))?.name).toBe('Bank');
  });

  it('menolak Dompet yang bukan milik pemilik', async () => {
    const repo = new InMemoryLedgerRepo({ Wallet: [wallet('w1', OTHER, 'Bank', 100)] });
    await expect(
      renameWallet(repo, OWNER, { id: 'w1', name: 'Baru' }),
    ).rejects.toMatchObject({ code: 'WALLET_NOT_FOUND' });
  });
});

describe('deleteWalletWithReassign', () => {
  it('menghapus Dompet tanpa Transaksi beserta penjaganya', async () => {
    const repo = new InMemoryLedgerRepo({
      Wallet: [wallet('w1', OWNER, 'Bank', 0), { id: walletGuardId(OWNER, 'bank'), owner: OWNER }],
    });
    const result = await deleteWalletWithReassign(repo, OWNER, { id: 'w1' });
    expect(result.deleted).toBe(true);
    expect(repo.dump('Wallet')).toHaveLength(0);
  });

  it('menolak hapus Dompet berisi Transaksi tanpa pengganti (NEEDS_REPLACEMENT)', async () => {
    const repo = new InMemoryLedgerRepo({
      Wallet: [wallet('w1', OWNER, 'Bank', 100)],
      Transaction: [txn('t1', OWNER, { walletId: 'w1' })],
    });
    await expect(
      deleteWalletWithReassign(repo, OWNER, { id: 'w1' }),
    ).rejects.toMatchObject({ code: 'NEEDS_REPLACEMENT' });
    expect(await repo.get('Wallet', OWNER, 'w1')).not.toBeNull();
  });

  it('memindahkan Transaksi ke pengganti dan menjaga total saldo', async () => {
    const repo = new InMemoryLedgerRepo({
      Wallet: [
        wallet('w1', OWNER, 'Bank', 300),
        { id: walletGuardId(OWNER, 'bank'), owner: OWNER },
        wallet('w2', OWNER, 'Tunai', 700),
        { id: walletGuardId(OWNER, 'tunai'), owner: OWNER },
      ],
      Transaction: [txn('t1', OWNER, { walletId: 'w1' }), txn('t2', OWNER, { walletId: 'w1' })],
    });
    const totalBefore = realOnly(repo.dump('Wallet')).reduce((s, w) => s + (w.balance as number), 0);

    const result = await deleteWalletWithReassign(repo, OWNER, { id: 'w1', replacementWalletId: 'w2' });

    expect(result.deleted).toBe(true);
    expect(result.reassignedCount).toBe(2);
    // Transaksi dipindahkan ke pengganti tanpa kehilangan.
    expect((await repo.get('Transaction', OWNER, 't1'))?.walletId).toBe('w2');
    expect((await repo.get('Transaction', OWNER, 't2'))?.walletId).toBe('w2');
    // Dompet terhapus, total saldo tidak berubah.
    expect(await repo.get('Wallet', OWNER, 'w1')).toBeNull();
    const totalAfter = realOnly(repo.dump('Wallet')).reduce((s, w) => s + (w.balance as number), 0);
    expect(totalAfter).toBe(totalBefore);
    expect((await repo.get('Wallet', OWNER, 'w2'))?.balance).toBe(1000);
  });

  it('idempoten saat Dompet sudah terhapus', async () => {
    const repo = new InMemoryLedgerRepo();
    const result = await deleteWalletWithReassign(repo, OWNER, { id: 'missing' });
    expect(result).toMatchObject({ deleted: false, reassignedCount: 0 });
  });
});

// --- Kategori -------------------------------------------------------------

describe('createCategory', () => {
  it('menyimpan Kategori baru dengan penjaga per jenis', async () => {
    const repo = new InMemoryLedgerRepo();
    const result = await createCategory(
      repo,
      OWNER,
      { name: 'Kopi', type: 'EXPENSE' },
      { newId: sequentialIds('c') },
    );
    expect(result.id).toBe('c-1');
    expect(result.type).toBe('EXPENSE');
    expect(repo.dump('Category').some((c) => c.id === categoryGuardId(OWNER, 'EXPENSE', 'kopi'))).toBe(true);
  });

  it('menolak nama ganda pada jenis yang sama', async () => {
    const repo = new InMemoryLedgerRepo();
    await createCategory(repo, OWNER, { name: 'Gaji', type: 'INCOME' }, { newId: sequentialIds('a') });
    await expect(
      createCategory(repo, OWNER, { name: 'gaji', type: 'INCOME' }, { newId: sequentialIds('b') }),
    ).rejects.toMatchObject({ code: 'NAME_TAKEN' });
  });

  it('mengizinkan nama sama pada jenis berbeda', async () => {
    const repo = new InMemoryLedgerRepo();
    await createCategory(repo, OWNER, { name: 'Lainnya', type: 'EXPENSE' }, { newId: sequentialIds('a') });
    await expect(
      createCategory(repo, OWNER, { name: 'Lainnya', type: 'INCOME' }, { newId: sequentialIds('b') }),
    ).resolves.toMatchObject({ type: 'INCOME' });
  });
});

describe('renameCategory', () => {
  it('mengganti nama dan memindahkan penjaga', async () => {
    const repo = new InMemoryLedgerRepo({
      Category: [
        category('c1', OWNER, 'Kopi', 'EXPENSE'),
        { id: categoryGuardId(OWNER, 'EXPENSE', 'kopi'), owner: OWNER },
      ],
    });
    const result = await renameCategory(repo, OWNER, { id: 'c1', name: 'Minuman' });
    expect(result.name).toBe('Minuman');
    const guards = repo.dump('Category').filter((c) => c.id.startsWith('UNIQ#'));
    expect(guards.map((g) => g.id)).toEqual([categoryGuardId(OWNER, 'EXPENSE', 'minuman')]);
  });
});

describe('deleteCategoryWithReassign', () => {
  it('menolak hapus Kategori berisi Transaksi tanpa pengganti', async () => {
    const repo = new InMemoryLedgerRepo({
      Category: [category('c1', OWNER, 'Kopi', 'EXPENSE')],
      Transaction: [txn('t1', OWNER, { walletId: 'w1', categoryId: 'c1' })],
    });
    await expect(
      deleteCategoryWithReassign(repo, OWNER, { id: 'c1' }),
    ).rejects.toMatchObject({ code: 'NEEDS_REPLACEMENT' });
  });

  it('memindahkan Transaksi ke pengganti dan menghapus Anggaran Kategori (K-6)', async () => {
    const repo = new InMemoryLedgerRepo({
      Category: [
        category('c1', OWNER, 'Kopi', 'EXPENSE'),
        { id: categoryGuardId(OWNER, 'EXPENSE', 'kopi'), owner: OWNER },
        category('c2', OWNER, 'Makan', 'EXPENSE'),
        { id: categoryGuardId(OWNER, 'EXPENSE', 'makan'), owner: OWNER },
      ],
      Transaction: [
        txn('t1', OWNER, { walletId: 'w1', categoryId: 'c1' }),
        txn('t2', OWNER, { walletId: 'w1', categoryId: 'c1' }),
      ],
      Budget: [
        { id: 'c1#2025-01', owner: OWNER, categoryId: 'c1', month: '2025-01', amount: 1000 } as ItemRecord,
        { id: 'c1#2025-02', owner: OWNER, categoryId: 'c1', month: '2025-02', amount: 1000 } as ItemRecord,
      ],
    });

    const result = await deleteCategoryWithReassign(repo, OWNER, { id: 'c1', replacementCategoryId: 'c2' });

    expect(result.deleted).toBe(true);
    expect(result.reassignedCount).toBe(2);
    expect(result.budgetsDeleted).toBe(2);
    expect((await repo.get('Transaction', OWNER, 't1'))?.categoryId).toBe('c2');
    expect((await repo.get('Transaction', OWNER, 't2'))?.categoryId).toBe('c2');
    expect(await repo.get('Category', OWNER, 'c1')).toBeNull();
    expect(repo.dump('Budget')).toHaveLength(0);
  });

  it('menolak pengganti dengan jenis berbeda', async () => {
    const repo = new InMemoryLedgerRepo({
      Category: [
        category('c1', OWNER, 'Kopi', 'EXPENSE'),
        category('c2', OWNER, 'Gaji', 'INCOME'),
      ],
      Transaction: [txn('t1', OWNER, { walletId: 'w1', categoryId: 'c1' })],
    });
    await expect(
      deleteCategoryWithReassign(repo, OWNER, { id: 'c1', replacementCategoryId: 'c2' }),
    ).rejects.toMatchObject({ code: 'REPLACEMENT_INVALID' });
  });

  it('menghapus Kategori tanpa Transaksi dan tetap membuang Anggarannya', async () => {
    const repo = new InMemoryLedgerRepo({
      Category: [
        category('c1', OWNER, 'Kopi', 'EXPENSE'),
        { id: categoryGuardId(OWNER, 'EXPENSE', 'kopi'), owner: OWNER },
      ],
      Budget: [{ id: 'c1#2025-01', owner: OWNER, categoryId: 'c1', month: '2025-01', amount: 1000 } as ItemRecord],
    });
    const result = await deleteCategoryWithReassign(repo, OWNER, { id: 'c1' });
    expect(result.deleted).toBe(true);
    expect(result.budgetsDeleted).toBe(1);
    expect(repo.dump('Category')).toHaveLength(0);
  });
});

describe('isolasi pemilik', () => {
  it('tidak melihat atau menghapus Kategori milik pemilik lain', async () => {
    const repo = new InMemoryLedgerRepo({ Category: [category('c1', OTHER, 'Kopi', 'EXPENSE')] });
    await expect(
      renameCategory(repo, OWNER, { id: 'c1', name: 'Baru' }),
    ).rejects.toMatchObject({ code: 'CATEGORY_NOT_FOUND' });
    const result = await deleteCategoryWithReassign(repo, OWNER, { id: 'c1' });
    expect(result.deleted).toBe(false);
  });
});

// Penanda agar galat terekspor dapat diinstansiasi (type guard).
it('WalletCategoryOperationError menyimpan code', () => {
  const err = new WalletCategoryOperationError('NAME_TAKEN', 'x');
  expect(err).toBeInstanceOf(Error);
  expect(err.code).toBe('NAME_TAKEN');
});
