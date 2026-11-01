import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Uji unit trigger `post-confirmation` (Requirement 3.1, 1.2).
 *
 * Klien DynamoDB palsu disuntikkan lewat `vi.mock` sehingga tidak ada panggilan
 * ke AWS. `sendMock` merekam setiap `PutCommand` dan dapat dikonfigurasi untuk
 * melempar galat (mis. `ConditionalCheckFailedException`) demi menguji idempotensi.
 */

// State bersama dibuat lewat vi.hoisted agar tersedia di dalam factory vi.mock
// yang diangkat ke atas berkas.
const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: class {},
}));

vi.mock('@aws-sdk/lib-dynamodb', () => {
  class PutCommand {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  }
  return {
    PutCommand,
    DynamoDBDocumentClient: {
      from: () => ({ send: sendMock }),
    },
  };
});

// Diimpor setelah mock diangkat; modul membuat klien palsu saat diimpor.
import { handler } from './handler';

const TABLE_ENV = {
  USERPROFILE_TABLE_NAME: 'tbl-UserProfile',
  NOTIFPREFS_TABLE_NAME: 'tbl-NotifPrefs',
  CATEGORY_TABLE_NAME: 'tbl-Category',
  WALLET_TABLE_NAME: 'tbl-Wallet',
} as const;

const SUB = '11111111-2222-3333-4444-555555555555';
const USERNAME = 'user-jane';
const OWNER = `${SUB}::${USERNAME}`;

interface PutInput {
  TableName: string;
  Item: Record<string, unknown>;
  ConditionExpression?: string;
}

function makeEvent(
  overrides: {
    triggerSource?: string;
    userName?: string;
    userAttributes?: Record<string, string>;
  } = {},
) {
  return {
    version: '1',
    triggerSource: overrides.triggerSource ?? 'PostConfirmation_ConfirmSignUp',
    region: 'ap-southeast-1',
    userPoolId: 'pool',
    userName: overrides.userName ?? USERNAME,
    request: {
      userAttributes: overrides.userAttributes ?? { sub: SUB, name: 'Jane', email: 'jane@example.com' },
    },
    response: {},
  };
}

/** Semua input `PutCommand` yang direkam, dalam urutan panggilan. */
function recordedPuts(): PutInput[] {
  return sendMock.mock.calls.map((call) => (call[0] as { input: PutInput }).input);
}

function putsForTable(table: string): PutInput[] {
  return recordedPuts().filter((p) => p.TableName === table);
}

/** Mengambil satu-satunya put untuk sebuah tabel; gagal bila jumlahnya bukan 1. */
function onePut(table: string): PutInput {
  const puts = putsForTable(table);
  expect(puts).toHaveLength(1);
  return puts[0] as PutInput;
}

beforeEach(() => {
  sendMock.mockReset();
  sendMock.mockResolvedValue({});
  for (const [key, value] of Object.entries(TABLE_ENV)) {
    process.env[key] = value;
  }
});

afterEach(() => {
  for (const key of Object.keys(TABLE_ENV)) {
    delete process.env[key];
  }
});

describe('post-confirmation: penyiapan data awal', () => {
  it('menulis UserProfile dengan id = sub dan displayName dari atribut nama', async () => {
    await handler(makeEvent());

    const profile = onePut(TABLE_ENV.USERPROFILE_TABLE_NAME);
    expect(profile.Item).toMatchObject({
      __typename: 'UserProfile',
      id: SUB,
      owner: OWNER,
      displayName: 'Jane',
    });
    expect(profile.ConditionExpression).toBe('attribute_not_exists(id)');
  });

  it('menulis NotifPrefs dengan semua jenis Notifikasi aktif', async () => {
    await handler(makeEvent());

    const prefs = onePut(TABLE_ENV.NOTIFPREFS_TABLE_NAME);
    expect(prefs.Item).toMatchObject({
      __typename: 'NotifPrefs',
      id: SUB,
      owner: OWNER,
      budget: true,
      recurring: true,
      goal: true,
      insight: true,
    });
  });

  it('menulis Kategori bawaan lengkap: 8 pengeluaran dan 4 pemasukan', async () => {
    await handler(makeEvent());

    const cats = putsForTable(TABLE_ENV.CATEGORY_TABLE_NAME);
    expect(cats).toHaveLength(12);

    const expense = cats.filter((c) => c.Item.type === 'EXPENSE');
    const income = cats.filter((c) => c.Item.type === 'INCOME');
    expect(expense).toHaveLength(8);
    expect(income).toHaveLength(4);

    // Setiap kategori ditandai bawaan, milik pemilik, dan punya kunci nama.
    for (const c of cats) {
      expect(c.Item.builtIn).toBe(true);
      expect(c.Item.owner).toBe(OWNER);
      expect(c.ConditionExpression).toBe('attribute_not_exists(id)');
    }

    const expenseNames = expense.map((c) => c.Item.name).sort();
    expect(expenseNames).toEqual(
      [
        'Makanan & Minuman',
        'Transportasi',
        'Belanja',
        'Tagihan & Utilitas',
        'Kesehatan',
        'Hiburan',
        'Pendidikan',
        'Lainnya',
      ].sort(),
    );
    expect(income.map((c) => c.Item.name).sort()).toEqual(['Gaji', 'Bonus', 'Hadiah', 'Lainnya'].sort());

    // ID deterministik mengikuti pola `<sub>:category:<type>:<nameKey>`.
    const gaji = income.find((c) => c.Item.name === 'Gaji');
    expect(gaji?.Item.id).toBe(`${SUB}:category:INCOME:gaji`);
    expect(gaji?.Item.nameKey).toBe('gaji');
  });

  it('menulis Dompet "Tunai" saldo 0 dengan id deterministik dan pemilik benar', async () => {
    await handler(makeEvent());

    const wallet = onePut(TABLE_ENV.WALLET_TABLE_NAME);
    expect(wallet.Item).toMatchObject({
      __typename: 'Wallet',
      id: `${SUB}:wallet:tunai`,
      name: 'Tunai',
      nameKey: 'tunai',
      owner: OWNER,
      initialBalance: 0,
      balance: 0,
    });
    expect(wallet.ConditionExpression).toBe('attribute_not_exists(id)');
  });

  it('menulis tepat 15 item dan mengembalikan event tanpa perubahan', async () => {
    const event = makeEvent();
    const result = await handler(event);

    // 1 profil + 1 prefs + 12 kategori + 1 dompet = 15.
    expect(sendMock).toHaveBeenCalledTimes(15);
    expect(result).toBe(event);
  });

  it('memakai owner "<sub>::<username>" pada setiap item', async () => {
    await handler(makeEvent());
    for (const put of recordedPuts()) {
      expect(put.Item.owner).toBe(OWNER);
    }
  });

  it('memakai email sebagai displayName saat atribut nama kosong', async () => {
    await handler(makeEvent({ userAttributes: { sub: SUB, email: 'only@example.com' } }));
    const profile = onePut(TABLE_ENV.USERPROFILE_TABLE_NAME);
    expect(profile.Item.displayName).toBe('only@example.com');
  });
});

describe('post-confirmation: idempotensi', () => {
  it('menelan ConditionalCheckFailedException sehingga trigger ulang tidak melempar', async () => {
    const conditional = Object.assign(new Error('item sudah ada'), {
      name: 'ConditionalCheckFailedException',
    });
    sendMock.mockRejectedValue(conditional);

    const event = makeEvent();
    await expect(handler(event)).resolves.toBe(event);
    // Semua 15 penulisan tetap dicoba meski gagal kondisional.
    expect(sendMock).toHaveBeenCalledTimes(15);
  });

  it('melempar kembali galat non-kondisional', async () => {
    const boom = Object.assign(new Error('gangguan jaringan'), { name: 'ServiceUnavailable' });
    sendMock.mockRejectedValue(boom);

    await expect(handler(makeEvent())).rejects.toThrow('gangguan jaringan');
  });
});

describe('post-confirmation: penyaringan sumber trigger', () => {
  it('mengabaikan sumber selain ConfirmSignUp tanpa menulis apa pun', async () => {
    const event = makeEvent({ triggerSource: 'PostConfirmation_ConfirmForgotPassword' });
    const result = await handler(event);

    expect(sendMock).not.toHaveBeenCalled();
    expect(result).toBe(event);
  });

  it('tetap memproses saat triggerSource tidak diset', async () => {
    const event = makeEvent({ triggerSource: undefined });
    await handler(event);
    expect(sendMock).toHaveBeenCalledTimes(15);
  });
});
