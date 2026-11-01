import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { ownerOf } from 'shared/domain';
import type { CategoryType } from 'shared/domain';

/**
 * Trigger Cognito `postConfirmation` (Requirement 3.1, 1.2).
 *
 * Dijalankan sekali saat sebuah akun diaktifkan. Menyiapkan data awal
 * Pengguna langsung ke tabel DynamoDB yang dikelola Amplify memakai SDK
 * (nama tabel dibaca dari variabel lingkungan yang dirangkai di
 * `amplify/backend.ts`):
 *
 * - `UserProfile`  — profil dasar (nama tampilan + waktu dibuat).
 * - `NotifPrefs`   — preferensi Notifikasi (semua jenis aktif).
 * - Kategori bawaan berbahasa Indonesia (pengeluaran dan pemasukan).
 * - Dompet "Tunai" saldo 0.
 *
 * Pemilik disimpan sebagai `<sub>::<username>` lewat `ownerOf` (Req 1.6,
 * 16.2). Seluruh penulisan memakai ID deterministik dan
 * `attribute_not_exists(id)` sehingga trigger yang terpicu ulang (mis.
 * konfirmasi ulang) tidak pernah menggandakan data (idempoten).
 */

/** Bentuk minimal event PostConfirmation yang kita pakai. */
interface PostConfirmationEvent {
  version?: string;
  triggerSource?: string;
  region?: string;
  userPoolId?: string;
  userName?: string;
  request: {
    userAttributes: Record<string, string>;
  };
  response: Record<string, unknown>;
}

interface BuiltInCategory {
  name: string;
  type: CategoryType;
}

/**
 * Kategori bawaan berbahasa Indonesia. Nama unik per jenis (Req 3.1).
 * Mencakup pengeluaran umum harian dan sumber pemasukan dasar.
 */
const BUILT_IN_CATEGORIES: readonly BuiltInCategory[] = [
  // Pengeluaran
  { name: 'Makanan & Minuman', type: 'EXPENSE' },
  { name: 'Transportasi', type: 'EXPENSE' },
  { name: 'Belanja', type: 'EXPENSE' },
  { name: 'Tagihan & Utilitas', type: 'EXPENSE' },
  { name: 'Kesehatan', type: 'EXPENSE' },
  { name: 'Hiburan', type: 'EXPENSE' },
  { name: 'Pendidikan', type: 'EXPENSE' },
  { name: 'Lainnya', type: 'EXPENSE' },
  // Pemasukan
  { name: 'Gaji', type: 'INCOME' },
  { name: 'Bonus', type: 'INCOME' },
  { name: 'Hadiah', type: 'INCOME' },
  { name: 'Lainnya', type: 'INCOME' },
];

const TUNAI_WALLET_NAME = 'Tunai';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

/** Membaca nama tabel wajib dari lingkungan; melempar bila belum dirangkai. */
function requireTable(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Variabel lingkungan ${key} belum diset`);
  }
  return value;
}

/**
 * Menormalkan nama menjadi kunci unik: huruf kecil, spasi tepi dibuang, dan
 * spasi ganda diringkas. Sepadan dengan item penjaga `UNIQ#...#<nameKey>`
 * pada Lambda `ledger`.
 */
function toNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Menulis satu item dengan `attribute_not_exists(id)` sehingga aman dipanggil
 * ulang. `ConditionalCheckFailedException` ditelan (item sudah ada → idempoten).
 */
async function putIfAbsent(table: string, item: Record<string, unknown>): Promise<void> {
  try {
    await ddb.send(
      new PutCommand({
        TableName: table,
        Item: item,
        ConditionExpression: 'attribute_not_exists(id)',
      }),
    );
  } catch (err) {
    if ((err as { name?: string })?.name === 'ConditionalCheckFailedException') {
      return;
    }
    throw err;
  }
}

/** Atribut dasar yang ditambahkan Amplify pada setiap item model. */
function baseAttributes(typename: string, owner: string, nowIso: string): Record<string, unknown> {
  return {
    __typename: typename,
    owner,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

export const handler = async (event: PostConfirmationEvent): Promise<PostConfirmationEvent> => {
  // Hanya tangani konfirmasi pendaftaran; abaikan sumber lain (mis. lupa sandi).
  if (event.triggerSource && event.triggerSource !== 'PostConfirmation_ConfirmSignUp') {
    return event;
  }

  const attrs = event.request.userAttributes ?? {};
  const sub = attrs.sub;
  const username = event.userName;
  const owner = ownerOf({ sub, username });

  const profileTable = requireTable('USERPROFILE_TABLE_NAME');
  const prefsTable = requireTable('NOTIFPREFS_TABLE_NAME');
  const categoryTable = requireTable('CATEGORY_TABLE_NAME');
  const walletTable = requireTable('WALLET_TABLE_NAME');

  const nowIso = new Date().toISOString();
  const displayName = attrs.name?.trim() || attrs.email?.trim() || '';

  const writes: Promise<void>[] = [];

  // UserProfile — satu per Pengguna (id = sub).
  writes.push(
    putIfAbsent(profileTable, {
      ...baseAttributes('UserProfile', owner, nowIso),
      id: sub,
      displayName,
    }),
  );

  // NotifPrefs — semua jenis Notifikasi aktif secara default (id = sub).
  writes.push(
    putIfAbsent(prefsTable, {
      ...baseAttributes('NotifPrefs', owner, nowIso),
      id: sub,
      budget: true,
      recurring: true,
      goal: true,
      insight: true,
    }),
  );

  // Kategori bawaan — ID deterministik agar idempoten lintas pemicu.
  for (const cat of BUILT_IN_CATEGORIES) {
    const nameKey = toNameKey(cat.name);
    writes.push(
      putIfAbsent(categoryTable, {
        ...baseAttributes('Category', owner, nowIso),
        id: `${sub}:category:${cat.type}:${nameKey}`,
        name: cat.name,
        nameKey,
        type: cat.type,
        builtIn: true,
      }),
    );
  }

  // Dompet "Tunai" saldo 0.
  const tunaiNameKey = toNameKey(TUNAI_WALLET_NAME);
  writes.push(
    putIfAbsent(walletTable, {
      ...baseAttributes('Wallet', owner, nowIso),
      id: `${sub}:wallet:${tunaiNameKey}`,
      name: TUNAI_WALLET_NAME,
      nameKey: tunaiNameKey,
      initialBalance: 0,
      balance: 0,
    }),
  );

  await Promise.all(writes);

  return event;
};
