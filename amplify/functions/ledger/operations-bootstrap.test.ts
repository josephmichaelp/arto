import { describe, expect, it } from 'vitest';

/**
 * Uji unit operasi `bootstrapUser` (Requirement 3.1, 1.2).
 *
 * Menggantikan uji trigger `post-confirmation` yang dilepas. Memakai
 * `InMemoryLedgerRepo` untuk Kategori/Dompet dan penulis palsu untuk
 * `UserProfile`/`NotifPrefs`, sehingga tidak ada panggilan ke AWS.
 */
import {
  BUILT_IN_CATEGORIES,
  BootstrapError,
  bootstrapTablesFromEnv,
  bootstrapUser,
  TUNAI_WALLET_NAME,
  type BootstrapStore,
  type BootstrapTables,
} from './operations-bootstrap';
import { createWallet, WalletCategoryOperationError } from './operations-wallet-category';
import { InMemoryLedgerRepo } from './repository';

const SUB = '11111111-2222-3333-4444-555555555555';
const USERNAME = 'user-jane';
const OWNER = `${SUB}::${USERNAME}`;

const TABLES: BootstrapTables = { profile: 'tbl-UserProfile', prefs: 'tbl-NotifPrefs' };

/** Penulis palsu yang merekam setiap penulisan dan meniru idempotensi. */
function makeStore() {
  const writes: { table: string; item: Record<string, unknown> }[] = [];
  const seen = new Set<string>();
  const store: BootstrapStore = {
    async putIfAbsent(table, item) {
      const key = `${table}#${String(item.id)}`;
      if (seen.has(key)) return; // meniru attribute_not_exists(id)
      seen.add(key);
      writes.push({ table, item });
    },
  };
  return { store, writes };
}

/** Pembuat ID berurutan agar hasil uji deterministik. */
function makeIdFactory() {
  let n = 0;
  return () => `id-${++n}`;
}

function setup() {
  const repo = new InMemoryLedgerRepo();
  const { store, writes } = makeStore();
  const run = () =>
    bootstrapUser(
      repo,
      OWNER,
      { sub: SUB, displayName: 'Jane' },
      { store, tables: TABLES, newId: makeIdFactory(), now: () => '2026-01-01T00:00:00.000Z' },
    );
  return { repo, store, writes, run };
}

/** Item nyata saja (membuang item penjaga keunikan `UNIQ#...`). */
function realItems<T extends { id: string }>(items: readonly T[]): T[] {
  return items.filter((i) => !i.id.startsWith('UNIQ#'));
}

describe('bootstrapUser: penyiapan data awal', () => {
  it('menulis UserProfile dengan id = sub dan displayName yang dikirim', async () => {
    const { writes, run } = setup();
    await run();

    const profile = writes.find((w) => w.table === TABLES.profile);
    expect(profile).toBeDefined();
    expect(profile!.item.id).toBe(SUB);
    expect(profile!.item.owner).toBe(OWNER);
    expect(profile!.item.displayName).toBe('Jane');
    expect(profile!.item.__typename).toBe('UserProfile');
  });

  it('menulis NotifPrefs dengan semua jenis notifikasi aktif', async () => {
    const { writes, run } = setup();
    await run();

    const prefs = writes.find((w) => w.table === TABLES.prefs);
    expect(prefs).toBeDefined();
    expect(prefs!.item.id).toBe(SUB);
    expect(prefs!.item).toMatchObject({
      budget: true,
      recurring: true,
      goal: true,
      insight: true,
    });
  });

  it('membuat seluruh Kategori bawaan dan menandainya builtIn', async () => {
    const { repo, run } = setup();
    const result = await run();

    expect(result.categoriesCreated).toBe(BUILT_IN_CATEGORIES.length);
    expect(result.categoriesAlreadyPresent).toBe(0);

    const categories = realItems(repo.dump('Category'));
    expect(categories).toHaveLength(BUILT_IN_CATEGORIES.length);
    expect(categories.every((c) => c.builtIn === true)).toBe(true);
    expect(categories.every((c) => c.owner === OWNER)).toBe(true);

    for (const expected of BUILT_IN_CATEGORIES) {
      expect(
        categories.some((c) => c.name === expected.name && c.type === expected.type),
      ).toBe(true);
    }
  });

  it('mengizinkan nama "Lainnya" pada pengeluaran dan pemasukan sekaligus', async () => {
    const { repo, run } = setup();
    await run();

    const lainnya = realItems(repo.dump('Category')).filter((c) => c.name === 'Lainnya');
    expect(lainnya).toHaveLength(2);
    expect(new Set(lainnya.map((c) => c.type))).toEqual(new Set(['EXPENSE', 'INCOME']));
  });

  it('membuat Dompet "Tunai" dengan saldo 0', async () => {
    const { repo, run } = setup();
    const result = await run();

    expect(result.walletCreated).toBe(true);
    const wallets = realItems(repo.dump('Wallet'));
    expect(wallets).toHaveLength(1);
    expect(wallets[0]).toMatchObject({
      name: TUNAI_WALLET_NAME,
      initialBalance: 0,
      balance: 0,
      owner: OWNER,
    });
  });
});

describe('bootstrapUser: idempotensi', () => {
  it('pemanggilan ulang tidak menggandakan data apa pun', async () => {
    const { repo, writes, run } = setup();
    await run();
    const second = await run();

    expect(second.categoriesCreated).toBe(0);
    expect(second.categoriesAlreadyPresent).toBe(BUILT_IN_CATEGORIES.length);
    expect(second.walletCreated).toBe(false);

    expect(realItems(repo.dump('Category'))).toHaveLength(BUILT_IN_CATEGORIES.length);
    expect(realItems(repo.dump('Wallet'))).toHaveLength(1);
    // Profil dan preferensi tetap satu item masing-masing.
    expect(writes.filter((w) => w.table === TABLES.profile)).toHaveLength(1);
    expect(writes.filter((w) => w.table === TABLES.prefs)).toHaveLength(1);
  });

  it('menulis item penjaga keunikan sehingga Dompet "Tunai" tidak bisa dibuat ganda', async () => {
    const { repo, run } = setup();
    await run();

    // Celah pada trigger lama: dulu Dompet bawaan ditulis tanpa penjaga,
    // sehingga Pengguna masih bisa membuat Dompet bernama sama.
    await expect(
      createWallet(repo, OWNER, { name: TUNAI_WALLET_NAME, initialBalance: 0 }, { newId: () => 'x' }),
    ).rejects.toThrow(WalletCategoryOperationError);
  });
});

describe('bootstrapUser: validasi', () => {
  it('menolak identitas tanpa sub', async () => {
    const repo = new InMemoryLedgerRepo();
    const { store } = makeStore();
    await expect(
      bootstrapUser(repo, OWNER, { sub: '' }, { store, tables: TABLES }),
    ).rejects.toMatchObject({ code: 'SUB_REQUIRED' });
  });

  it('memakai string kosong bila displayName tidak dikirim', async () => {
    const repo = new InMemoryLedgerRepo();
    const { store, writes } = makeStore();
    await bootstrapUser(repo, OWNER, { sub: SUB }, { store, tables: TABLES, newId: makeIdFactory() });

    const profile = writes.find((w) => w.table === TABLES.profile);
    expect(profile!.item.displayName).toBe('');
  });
});

describe('bootstrapTablesFromEnv', () => {
  it('membaca kedua nama tabel dari lingkungan', () => {
    const tables = bootstrapTablesFromEnv({
      USERPROFILE_TABLE_NAME: 'a',
      NOTIFPREFS_TABLE_NAME: 'b',
    } as NodeJS.ProcessEnv);
    expect(tables).toEqual({ profile: 'a', prefs: 'b' });
  });

  it('melempar TABLES_NOT_WIRED bila ada yang hilang', () => {
    expect(() => bootstrapTablesFromEnv({ USERPROFILE_TABLE_NAME: 'a' } as NodeJS.ProcessEnv))
      .toThrow(BootstrapError);
  });
});