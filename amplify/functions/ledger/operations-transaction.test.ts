import { describe, expect, it } from 'vitest';
import { InMemoryLedgerRepo, type ItemRecord } from './repository';
import {
  deleteTransaction,
  depositToGoal,
  LedgerOperationError,
  saveTransaction,
  transferFunds,
} from './operations-transaction';

const OWNER = 'sub-a::user-a';
const OTHER = 'sub-b::user-b';

function wallet(id: string, owner: string, balance: number): ItemRecord {
  return { id, owner, name: id, nameKey: id.toLowerCase(), initialBalance: balance, balance };
}

/** Pembuat ID deterministik untuk uji. */
function sequentialIds(prefix = 'id'): () => string {
  let n = 0;
  return () => `${prefix}-${(n += 1)}`;
}

describe('saveTransaction: pembuatan', () => {
  it('menyimpan Transaksi baru dan memperbarui saldo Dompet untuk EXPENSE', async () => {
    const repo = new InMemoryLedgerRepo({ Wallet: [wallet('w1', OWNER, 1000)] });
    const result = await saveTransaction(
      repo,
      OWNER,
      { type: 'EXPENSE', amount: 250, date: '2025-01-15', categoryId: 'c1', walletId: 'w1', note: 'Kopi' },
      { newId: sequentialIds('t') },
    );

    expect(result.mode).toBe('create');
    expect(result.transaction.id).toBe('t-1');
    expect(result.transaction.month).toBe('2025-01');
    expect(result.transaction.searchText).toBe('kopi');
    expect((await repo.get('Wallet', OWNER, 'w1'))?.balance).toBe(750);
  });

  it('menambah saldo untuk INCOME', async () => {
    const repo = new InMemoryLedgerRepo({ Wallet: [wallet('w1', OWNER, 1000)] });
    await saveTransaction(
      repo,
      OWNER,
      { type: 'INCOME', amount: 500, date: '2025-02-01', walletId: 'w1' },
      { newId: sequentialIds('t') },
    );
    expect((await repo.get('Wallet', OWNER, 'w1'))?.balance).toBe(1500);
  });

  it('menolak nominal tidak valid dengan pesan berbahasa Indonesia', async () => {
    const repo = new InMemoryLedgerRepo({ Wallet: [wallet('w1', OWNER, 1000)] });
    await expect(
      saveTransaction(repo, OWNER, { type: 'EXPENSE', amount: 0, date: '2025-01-01', walletId: 'w1' }),
    ).rejects.toMatchObject({ code: 'AMOUNT_INVALID', message: 'Nominal harus berupa angka bulat lebih dari 0' });
    // Tidak ada perubahan saldo.
    expect((await repo.get('Wallet', OWNER, 'w1'))?.balance).toBe(1000);
  });

  it('menolak Dompet yang bukan milik pemilik', async () => {
    const repo = new InMemoryLedgerRepo({ Wallet: [wallet('w1', OTHER, 1000)] });
    await expect(
      saveTransaction(repo, OWNER, { type: 'EXPENSE', amount: 10, date: '2025-01-01', walletId: 'w1' }),
    ).rejects.toMatchObject({ code: 'WALLET_NOT_FOUND' });
  });
});

describe('saveTransaction: pengubahan', () => {
  it('menghitung ulang saldo saat nominal berubah pada Dompet yang sama', async () => {
    const repo = new InMemoryLedgerRepo({
      Wallet: [wallet('w1', OWNER, 1000)],
      Transaction: [
        {
          id: 't1',
          owner: OWNER,
          type: 'EXPENSE',
          amount: 100,
          date: '2025-01-10',
          month: '2025-01',
          categoryId: 'c1',
          walletId: 'w1',
        },
      ],
    });
    // Saldo awal sudah mencerminkan Transaksi 100 (saldo 1000 pada seed = kondisi uji).
    const result = await saveTransaction(repo, OWNER, {
      id: 't1',
      type: 'EXPENSE',
      amount: 300,
      date: '2025-01-10',
      categoryId: 'c1',
      walletId: 'w1',
    });
    expect(result.mode).toBe('update');
    // Delta ubah: kembalikan +100 lalu kurangi 300 => -200.
    expect((await repo.get('Wallet', OWNER, 'w1'))?.balance).toBe(800);
  });

  it('memindahkan delta ke dua Dompet saat Dompet berpindah', async () => {
    const repo = new InMemoryLedgerRepo({
      Wallet: [wallet('w1', OWNER, 1000), wallet('w2', OWNER, 500)],
      Transaction: [
        {
          id: 't1',
          owner: OWNER,
          type: 'EXPENSE',
          amount: 200,
          date: '2025-01-10',
          month: '2025-01',
          categoryId: 'c1',
          walletId: 'w1',
        },
      ],
    });
    await saveTransaction(repo, OWNER, {
      id: 't1',
      type: 'EXPENSE',
      amount: 200,
      date: '2025-01-10',
      categoryId: 'c1',
      walletId: 'w2',
    });
    // w1 dikembalikan +200, w2 dikurangi 200.
    expect((await repo.get('Wallet', OWNER, 'w1'))?.balance).toBe(1200);
    expect((await repo.get('Wallet', OWNER, 'w2'))?.balance).toBe(300);
  });
});

describe('saveTransaction: evaluasi ambang Anggaran', () => {
  it('membuat Notifikasi 80 persen dan 100 persen sekali saat pengeluaran melampaui Anggaran', async () => {
    const repo = new InMemoryLedgerRepo({
      Wallet: [wallet('w1', OWNER, 1_000_000)],
      Budget: [
        { id: 'c1#2025-01', owner: OWNER, categoryId: 'c1', month: '2025-01', amount: 100_000 },
      ],
    });
    const result = await saveTransaction(
      repo,
      OWNER,
      { type: 'EXPENSE', amount: 150_000, date: '2025-01-05', categoryId: 'c1', walletId: 'w1' },
      { newId: sequentialIds('t') },
    );
    expect(result.budgets).toHaveLength(1);
    const budget = result.budgets[0]!;
    expect(budget.warn80).toBe(true);
    expect(budget.over100).toBe(true);
    expect(await repo.get('Notification', OWNER, 'budget80:c1#2025-01')).not.toBeNull();
    expect(await repo.get('Notification', OWNER, 'over100:c1#2025-01')).not.toBeNull();
  });
});

describe('deleteTransaction', () => {
  it('menghapus Transaksi dan mengembalikan saldo', async () => {
    const repo = new InMemoryLedgerRepo({
      Wallet: [wallet('w1', OWNER, 800)],
      Transaction: [
        {
          id: 't1',
          owner: OWNER,
          type: 'EXPENSE',
          amount: 200,
          date: '2025-01-10',
          month: '2025-01',
          walletId: 'w1',
        },
      ],
    });
    await deleteTransaction(repo, OWNER, 't1');
    expect(await repo.get('Transaction', OWNER, 't1')).toBeNull();
    // EXPENSE dihapus mengembalikan +200.
    expect((await repo.get('Wallet', OWNER, 'w1'))?.balance).toBe(1000);
  });

  it('menolak Transaksi yang tidak ada atau bukan milik pemilik', async () => {
    const repo = new InMemoryLedgerRepo({
      Transaction: [
        { id: 't1', owner: OTHER, type: 'EXPENSE', amount: 10, date: '2025-01-01', month: '2025-01', walletId: 'w1' },
      ],
    });
    await expect(deleteTransaction(repo, OWNER, 't1')).rejects.toMatchObject({ code: 'TRANSACTION_NOT_FOUND' });
  });
});

describe('transferFunds', () => {
  it('memindahkan dana dan menulis dua catatan transfer', async () => {
    const repo = new InMemoryLedgerRepo({
      Wallet: [wallet('w1', OWNER, 1000), wallet('w2', OWNER, 200)],
    });
    const result = await transferFunds(
      repo,
      OWNER,
      { fromWalletId: 'w1', toWalletId: 'w2', amount: 300, date: '2025-03-01' },
      { newId: sequentialIds('tr') },
    );

    expect((await repo.get('Wallet', OWNER, 'w1'))?.balance).toBe(700);
    expect((await repo.get('Wallet', OWNER, 'w2'))?.balance).toBe(500);
    expect(result.transferOut.type).toBe('TRANSFER_OUT');
    expect(result.transferIn.type).toBe('TRANSFER_IN');
    expect((await repo.list('Transaction', OWNER)).length).toBe(2);
  });

  it('menolak transfer melebihi saldo tanpa mengubah saldo apa pun', async () => {
    const repo = new InMemoryLedgerRepo({
      Wallet: [wallet('w1', OWNER, 100), wallet('w2', OWNER, 0)],
    });
    await expect(
      transferFunds(repo, OWNER, { fromWalletId: 'w1', toWalletId: 'w2', amount: 500, date: '2025-03-01' }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE', message: 'Saldo dompet asal tidak cukup' });
    expect((await repo.get('Wallet', OWNER, 'w1'))?.balance).toBe(100);
    expect((await repo.get('Wallet', OWNER, 'w2'))?.balance).toBe(0);
    expect((await repo.list('Transaction', OWNER)).length).toBe(0);
  });

  it('menolak transfer ke Dompet yang sama', async () => {
    const repo = new InMemoryLedgerRepo({ Wallet: [wallet('w1', OWNER, 100)] });
    await expect(
      transferFunds(repo, OWNER, { fromWalletId: 'w1', toWalletId: 'w1', amount: 10, date: '2025-03-01' }),
    ).rejects.toMatchObject({ code: 'SAME_WALLET' });
  });
});

describe('depositToGoal', () => {
  it('menambah progres Target dan mengurangi saldo Dompet', async () => {
    const repo = new InMemoryLedgerRepo({
      Wallet: [wallet('w1', OWNER, 1000)],
      Goal: [{ id: 'g1', owner: OWNER, name: 'Liburan', target: 1000, saved: 0 }],
    });
    const result = await depositToGoal(repo, OWNER, { goalId: 'g1', walletId: 'w1', amount: 400 });
    expect(result.saved).toBe(400);
    expect(result.achieved).toBe(false);
    expect(result.newlyAchieved).toBe(false);
    expect((await repo.get('Wallet', OWNER, 'w1'))?.balance).toBe(600);
    expect((await repo.get('Goal', OWNER, 'g1'))?.saved).toBe(400);
  });

  it('menandai tercapai dan membuat Notifikasi goal-done saat mencapai target', async () => {
    const repo = new InMemoryLedgerRepo({
      Wallet: [wallet('w1', OWNER, 1000)],
      Goal: [{ id: 'g1', owner: OWNER, name: 'Liburan', target: 1000, saved: 700 }],
    });
    const result = await depositToGoal(repo, OWNER, { goalId: 'g1', walletId: 'w1', amount: 300 });
    expect(result.achieved).toBe(true);
    expect(result.newlyAchieved).toBe(true);
    expect((await repo.get('Goal', OWNER, 'g1'))?.achieved).toBe(true);
    expect(result.notification?.id).toBe('goal-done:g1');
    expect(await repo.get('Notification', OWNER, 'goal-done:g1')).not.toBeNull();
  });

  it('menolak setoran melebihi saldo Dompet', async () => {
    const repo = new InMemoryLedgerRepo({
      Wallet: [wallet('w1', OWNER, 100)],
      Goal: [{ id: 'g1', owner: OWNER, name: 'Liburan', target: 1000, saved: 0 }],
    });
    await expect(
      depositToGoal(repo, OWNER, { goalId: 'g1', walletId: 'w1', amount: 500 }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE', message: 'Saldo dompet asal tidak cukup' });
    expect((await repo.get('Wallet', OWNER, 'w1'))?.balance).toBe(100);
    expect((await repo.get('Goal', OWNER, 'g1'))?.saved).toBe(0);
  });

  it('menolak Target yang bukan milik pemilik', async () => {
    const repo = new InMemoryLedgerRepo({
      Wallet: [wallet('w1', OWNER, 1000)],
      Goal: [{ id: 'g1', owner: OTHER, name: 'Liburan', target: 1000, saved: 0 }],
    });
    await expect(
      depositToGoal(repo, OWNER, { goalId: 'g1', walletId: 'w1', amount: 100 }),
    ).rejects.toBeInstanceOf(LedgerOperationError);
  });
});
