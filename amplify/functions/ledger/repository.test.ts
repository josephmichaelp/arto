import { describe, expect, it } from 'vitest';
import {
  ConditionalCheckError,
  InMemoryLedgerRepo,
  MAX_TRANSACT_ITEMS,
  TABLE_ENV_KEYS,
  tableNamesFromEnv,
  type ItemRecord,
  type WriteOp,
} from './repository';

const OWNER_A = 'sub-a::user-a';
const OWNER_B = 'sub-b::user-b';

function wallet(id: string, owner: string, balance: number): ItemRecord {
  return { id, owner, name: id, nameKey: id.toLowerCase(), initialBalance: 0, balance };
}

describe('InMemoryLedgerRepo: isolasi pemilik', () => {
  it('get hanya mengembalikan item milik pemilik yang diminta', async () => {
    const repo = new InMemoryLedgerRepo({ Wallet: [wallet('w1', OWNER_A, 1000)] });
    expect(await repo.get('Wallet', OWNER_A, 'w1')).not.toBeNull();
    expect(await repo.get('Wallet', OWNER_B, 'w1')).toBeNull();
  });

  it('list hanya memuat item pemilik dan menerapkan penyaring kesetaraan', async () => {
    const repo = new InMemoryLedgerRepo({
      Transaction: [
        { id: 't1', owner: OWNER_A, type: 'EXPENSE', amount: 10, date: '2025-01-01', month: '2025-01', walletId: 'w1' },
        { id: 't2', owner: OWNER_A, type: 'EXPENSE', amount: 20, date: '2025-01-02', month: '2025-01', walletId: 'w2' },
        { id: 't3', owner: OWNER_B, type: 'EXPENSE', amount: 30, date: '2025-01-03', month: '2025-01', walletId: 'w1' },
      ],
    });
    const all = await repo.list('Transaction', OWNER_A);
    expect(all.map((t) => t.id).sort()).toEqual(['t1', 't2']);

    const filtered = await repo.list('Transaction', OWNER_A, { walletId: 'w1' });
    expect(filtered.map((t) => t.id)).toEqual(['t1']);
  });
});

describe('InMemoryLedgerRepo: metadata', () => {
  it('put mengisi __typename, createdAt, dan updatedAt', async () => {
    const repo = new InMemoryLedgerRepo();
    await repo.put('Wallet', wallet('w1', OWNER_A, 0));
    const stored = await repo.get('Wallet', OWNER_A, 'w1');
    expect(stored?.__typename).toBe('Wallet');
    expect(typeof stored?.createdAt).toBe('string');
    expect(typeof stored?.updatedAt).toBe('string');
  });
});

describe('InMemoryLedgerRepo: penulisan kondisional', () => {
  it('notExists mencegah penimpaan item yang sudah ada', async () => {
    const repo = new InMemoryLedgerRepo({ Wallet: [wallet('w1', OWNER_A, 100)] });
    await expect(repo.put('Wallet', wallet('w1', OWNER_A, 999), { kind: 'notExists' })).rejects.toBeInstanceOf(
      ConditionalCheckError,
    );
    const stored = await repo.get('Wallet', OWNER_A, 'w1');
    expect(stored?.balance).toBe(100);
  });

  it('numberGte menolak saldo kurang dan mengizinkan saldo cukup', async () => {
    const repo = new InMemoryLedgerRepo({ Wallet: [wallet('w1', OWNER_A, 100)] });
    await expect(
      repo.update('Wallet', 'w1', { add: { balance: -150 } }, { kind: 'numberGte', attribute: 'balance', value: 150 }),
    ).rejects.toBeInstanceOf(ConditionalCheckError);

    await repo.update('Wallet', 'w1', { add: { balance: -40 } }, { kind: 'numberGte', attribute: 'balance', value: 40 });
    const stored = await repo.get('Wallet', OWNER_A, 'w1');
    expect(stored?.balance).toBe(60);
  });

  it('equals menegakkan nextIndex yang diharapkan', async () => {
    const repo = new InMemoryLedgerRepo({
      RecurringRule: [
        {
          id: 'r1',
          owner: OWNER_A,
          amount: 10,
          categoryId: 'c1',
          walletId: 'w1',
          type: 'EXPENSE',
          frequency: 'MONTHLY',
          startDate: '2025-01-01',
          nextIndex: 2,
          status: 'ACTIVE',
        },
      ],
    });
    await expect(
      repo.update('RecurringRule', 'r1', { set: { nextIndex: 4 } }, { kind: 'equals', attribute: 'nextIndex', value: 3 }),
    ).rejects.toBeInstanceOf(ConditionalCheckError);

    await repo.update('RecurringRule', 'r1', { set: { nextIndex: 3 } }, { kind: 'equals', attribute: 'nextIndex', value: 2 });
    const stored = await repo.get('RecurringRule', OWNER_A, 'r1');
    expect(stored?.nextIndex).toBe(3);
  });
});

describe('InMemoryLedgerRepo: transactWrite', () => {
  it('menerapkan transfer atomik: kurangi asal, tambah tujuan', async () => {
    const repo = new InMemoryLedgerRepo({
      Wallet: [wallet('w1', OWNER_A, 100), wallet('w2', OWNER_A, 10)],
    });
    await repo.transactWrite([
      { op: 'update', entity: 'Wallet', id: 'w1', add: { balance: -30 }, condition: { kind: 'numberGte', attribute: 'balance', value: 30 } },
      { op: 'update', entity: 'Wallet', id: 'w2', add: { balance: 30 } },
    ]);
    expect((await repo.get('Wallet', OWNER_A, 'w1'))?.balance).toBe(70);
    expect((await repo.get('Wallet', OWNER_A, 'w2'))?.balance).toBe(40);
  });

  it('tidak menerapkan perubahan apa pun bila satu prasyarat gagal', async () => {
    const repo = new InMemoryLedgerRepo({
      Wallet: [wallet('w1', OWNER_A, 20), wallet('w2', OWNER_A, 10)],
    });
    await expect(
      repo.transactWrite([
        { op: 'update', entity: 'Wallet', id: 'w1', add: { balance: -30 }, condition: { kind: 'numberGte', attribute: 'balance', value: 30 } },
        { op: 'update', entity: 'Wallet', id: 'w2', add: { balance: 30 } },
      ]),
    ).rejects.toBeInstanceOf(ConditionalCheckError);
    expect((await repo.get('Wallet', OWNER_A, 'w1'))?.balance).toBe(20);
    expect((await repo.get('Wallet', OWNER_A, 'w2'))?.balance).toBe(10);
  });

  it('put idempoten lewat notExists: transaksi berulang kedua gagal tanpa menggandakan', async () => {
    const repo = new InMemoryLedgerRepo({ Wallet: [wallet('w1', OWNER_A, 100)] });
    const txn: ItemRecord = {
      id: 'rec:r1:2025-01-01',
      owner: OWNER_A,
      type: 'EXPENSE',
      amount: 25,
      date: '2025-01-01',
      month: '2025-01',
      walletId: 'w1',
    };
    const ops: WriteOp[] = [
      { op: 'put', entity: 'Transaction', item: txn, condition: { kind: 'notExists' } },
      { op: 'update', entity: 'Wallet', id: 'w1', add: { balance: -25 } },
    ];
    await repo.transactWrite(ops);
    await expect(repo.transactWrite(ops)).rejects.toBeInstanceOf(ConditionalCheckError);
    expect((await repo.get('Wallet', OWNER_A, 'w1'))?.balance).toBe(75);
    expect((await repo.list('Transaction', OWNER_A)).length).toBe(1);
  });

  it('menolak dua operasi pada item yang sama', async () => {
    const repo = new InMemoryLedgerRepo({ Wallet: [wallet('w1', OWNER_A, 100)] });
    await expect(
      repo.transactWrite([
        { op: 'update', entity: 'Wallet', id: 'w1', add: { balance: 1 } },
        { op: 'update', entity: 'Wallet', id: 'w1', add: { balance: 2 } },
      ]),
    ).rejects.toThrow(/item yang sama/);
  });

  it('menolak melebihi batas item transaksi', async () => {
    const repo = new InMemoryLedgerRepo();
    const ops: WriteOp[] = Array.from({ length: MAX_TRANSACT_ITEMS + 1 }, (_, i) => ({
      op: 'put',
      entity: 'Notification',
      item: { id: `n${i}`, owner: OWNER_A, type: 'test', title: 't' },
    }));
    await expect(repo.transactWrite(ops)).rejects.toThrow(/melebihi batas/);
  });
});

describe('tableNamesFromEnv', () => {
  it('membangun peta dari variabel lingkungan', () => {
    const env: NodeJS.ProcessEnv = {};
    for (const key of Object.values(TABLE_ENV_KEYS)) {
      env[key] = `${key}-value`;
    }
    const tables = tableNamesFromEnv(env);
    expect(tables.Wallet).toBe('WALLET_TABLE_NAME-value');
    expect(tables.RecurringRule).toBe('RECURRING_RULE_TABLE_NAME-value');
  });

  it('melempar galat bila ada variabel yang hilang', () => {
    expect(() => tableNamesFromEnv({})).toThrow(/WALLET_TABLE_NAME/);
  });
});
