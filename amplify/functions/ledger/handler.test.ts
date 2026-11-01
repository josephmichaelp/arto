/**
 * Uji unit perangkaian `ledger/handler.ts` (tugas 7.6).
 *
 * Fokus: penurunan `owner` dari identitas (dan penolakan identitas kosong),
 * perutean field mutation ke operasi yang tepat, pemuatan `NotifPrefs`, dan
 * pemetaan galat operasi berbahasa Indonesia menjadi amplop galat.
 */
import { describe, expect, it, vi } from 'vitest';
import { InMemoryLedgerRepo, type ItemRecord } from './repository';
import {
  dispatchLedgerOperation,
  type LedgerEnvelope,
  type LedgerHandlerDeps,
  type LedgerResolverEvent,
  type PrefsLoader,
} from './handler';

const IDENTITY = { sub: 'sub-1', username: 'user-1' };
const OWNER = 'sub-1::user-1';

function seededRepo(): InMemoryLedgerRepo {
  return new InMemoryLedgerRepo({
    Wallet: [
      { id: 'w1', owner: OWNER, name: 'Tunai', nameKey: 'tunai', initialBalance: 100000, balance: 100000 },
      { id: 'w2', owner: OWNER, name: 'Bank', nameKey: 'bank', initialBalance: 0, balance: 0 },
    ] as unknown as ItemRecord[],
    Category: [
      { id: 'c1', owner: OWNER, name: 'Makan', nameKey: 'makan', type: 'EXPENSE', builtIn: true },
    ] as unknown as ItemRecord[],
    Goal: [
      { id: 'g1', owner: OWNER, name: 'Liburan', target: 50000, saved: 0, achieved: false },
    ] as unknown as ItemRecord[],
  });
}

function makeDeps(repo: InMemoryLedgerRepo, overrides: Partial<LedgerHandlerDeps> = {}): LedgerHandlerDeps {
  let counter = 0;
  return {
    repo,
    loadPrefs: async () => ({ budget: true, recurring: true, goal: true, insight: true }),
    newId: () => `id-${(counter += 1)}`,
    ...overrides,
  };
}

function event(fieldName: string, input: unknown, identity: unknown = IDENTITY): LedgerResolverEvent {
  return {
    info: { fieldName },
    arguments: { input },
    identity: identity as LedgerResolverEvent['identity'],
  };
}

function expectError(env: LedgerEnvelope): { code: string; message: string } {
  if (env.ok) throw new Error(`diharapkan galat, tetapi sukses: ${JSON.stringify(env)}`);
  return env.error;
}

describe('dispatchLedgerOperation — identitas', () => {
  it('menolak identitas kosong tanpa menjalankan operasi', async () => {
    const repo = seededRepo();
    const deps = makeDeps(repo);
    const result = await dispatchLedgerOperation(deps, event('createWallet', { name: 'Baru', initialBalance: 0 }, null));

    expect(expectError(result).code).toBe('UNAUTHENTICATED');
    // Tidak ada Dompet baru yang ditulis.
    expect(repo.dump('Wallet')).toHaveLength(2);
  });

  it('menolak identitas dengan sub/username kosong', async () => {
    const repo = seededRepo();
    const result = await dispatchLedgerOperation(makeDeps(repo), event('createWallet', {}, { sub: '', username: '' }));
    expect(expectError(result).code).toBe('UNAUTHENTICATED');
  });
});

describe('dispatchLedgerOperation — perutean', () => {
  it('createWallet membuat Dompet milik pemilik', async () => {
    const repo = seededRepo();
    const result = await dispatchLedgerOperation(makeDeps(repo), event('createWallet', { name: 'Dompet Baru', initialBalance: 5000 }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      const wallet = result.data as { id: string; name: string; owner: string };
      expect(wallet.name).toBe('Dompet Baru');
      expect(wallet.owner).toBe(OWNER);
    }
  });

  it('saveTransaction menyimpan Transaksi dan mengurangi saldo Dompet', async () => {
    const repo = seededRepo();
    const result = await dispatchLedgerOperation(
      makeDeps(repo),
      event('saveTransaction', { type: 'EXPENSE', amount: 25000, date: '2024-05-10', categoryId: 'c1', walletId: 'w1' }),
    );
    expect(result.ok).toBe(true);
    const wallet = await repo.get('Wallet', OWNER, 'w1');
    expect(wallet?.balance).toBe(75000);
  });

  it('transferFunds memindahkan dana antar Dompet', async () => {
    const repo = seededRepo();
    const result = await dispatchLedgerOperation(
      makeDeps(repo),
      event('transferFunds', { fromWalletId: 'w1', toWalletId: 'w2', amount: 40000, date: '2024-05-10' }),
    );
    expect(result.ok).toBe(true);
    expect((await repo.get('Wallet', OWNER, 'w1'))?.balance).toBe(60000);
    expect((await repo.get('Wallet', OWNER, 'w2'))?.balance).toBe(40000);
  });

  it('depositToGoal memuat NotifPrefs dan membuat Notifikasi saat Target tercapai', async () => {
    const repo = seededRepo();
    const loadPrefs = vi.fn<PrefsLoader>(async () => ({ goal: true }));
    const result = await dispatchLedgerOperation(
      makeDeps(repo, { loadPrefs }),
      event('depositToGoal', { goalId: 'g1', walletId: 'w1', amount: 50000 }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as { achieved: boolean; newlyAchieved: boolean };
      expect(data.achieved).toBe(true);
      expect(data.newlyAchieved).toBe(true);
    }
    expect(loadPrefs).toHaveBeenCalledWith('sub-1', OWNER);
    expect(repo.dump('Notification')).toHaveLength(1);
  });

  it('operasi tak dikenal menghasilkan galat UNKNOWN_OPERATION', async () => {
    const repo = seededRepo();
    const result = await dispatchLedgerOperation(makeDeps(repo), event('doesNotExist', {}));
    expect(expectError(result).code).toBe('UNKNOWN_OPERATION');
  });
});

describe('dispatchLedgerOperation — pemetaan galat berbahasa Indonesia', () => {
  it('transfer melebihi saldo menghasilkan galat saldo tidak cukup', async () => {
    const repo = seededRepo();
    const result = await dispatchLedgerOperation(
      makeDeps(repo),
      event('transferFunds', { fromWalletId: 'w1', toWalletId: 'w2', amount: 999999, date: '2024-05-10' }),
    );
    const err = expectError(result);
    expect(err.code).toBe('INSUFFICIENT_BALANCE');
    expect(err.message).toBe('Saldo dompet asal tidak cukup');
  });

  it('nama Dompet ganda menghasilkan galat nama sudah dipakai', async () => {
    const repo = seededRepo();
    // Buat Dompet lewat handler agar item penjaga keunikan ikut ditulis.
    const first = await dispatchLedgerOperation(makeDeps(repo), event('createWallet', { name: 'Dompet X', initialBalance: 0 }));
    expect(first.ok).toBe(true);
    const result = await dispatchLedgerOperation(
      makeDeps(repo),
      event('createWallet', { name: 'Dompet X', initialBalance: 0 }),
    );
    const err = expectError(result);
    expect(err.code).toBe('NAME_TAKEN');
    expect(err.message).toBe('Nama sudah dipakai');
  });

  it('nominal tidak valid menghasilkan galat AMOUNT_INVALID', async () => {
    const repo = seededRepo();
    const result = await dispatchLedgerOperation(
      makeDeps(repo),
      event('upsertBudget', { categoryId: 'c1', month: '2024-05', amount: -5 }),
    );
    expect(expectError(result).code).toBe('AMOUNT_INVALID');
  });

  it('menghapus Kategori berisi Transaksi tanpa pengganti meminta pengganti', async () => {
    const repo = seededRepo();
    // Tambahkan satu Transaksi pada Kategori c1.
    await dispatchLedgerOperation(
      makeDeps(repo),
      event('saveTransaction', { type: 'EXPENSE', amount: 1000, date: '2024-05-10', categoryId: 'c1', walletId: 'w1' }),
    );
    const result = await dispatchLedgerOperation(makeDeps(repo), event('deleteCategoryWithReassign', { id: 'c1' }));
    expect(expectError(result).code).toBe('NEEDS_REPLACEMENT');
  });
});

describe('dispatchLedgerOperation — isolasi pemilik', () => {
  it('tidak melihat Dompet milik pemilik lain', async () => {
    const repo = seededRepo();
    const result = await dispatchLedgerOperation(
      makeDeps(repo),
      event('renameWallet', { id: 'w1', name: 'Milikku' }, { sub: 'sub-2', username: 'user-2' }),
    );
    // Dompet w1 bukan milik sub-2::user-2, sehingga dianggap tidak ada.
    expect(expectError(result).code).toBe('WALLET_NOT_FOUND');
  });
});
