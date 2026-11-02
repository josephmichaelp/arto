/**
 * Operasi `bootstrapUser` pada Lambda `ledger`.
 *
 * Menyiapkan data awal sebuah akun secara idempoten:
 *
 * - `UserProfile` — profil dasar (nama tampilan + waktu dibuat), id = `sub`.
 * - `NotifPrefs`  — preferensi Notifikasi (semua jenis aktif), id = `sub`.
 * - Kategori bawaan berbahasa Indonesia (pengeluaran dan pemasukan).
 * - Dompet "Tunai" saldo 0.
 *
 * Sebelumnya pekerjaan ini dilakukan trigger Cognito `post-confirmation`.
 * Trigger tersebut dilepas karena menimbulkan dependensi sirkular antar
 * nested stack yang tidak dapat diselesaikan: `data` membutuhkan user pool
 * dari `auth` (authorizer), `auth` membutuhkan ARN fungsi trigger, dan
 * fungsi trigger membutuhkan referensi tabel `data`. Lambda `ledger` sudah
 * berada di stack `data` dan sudah memegang akses tabel, sehingga penyiapan
 * di sini tidak menambah sisi dependensi apa pun.
 *
 * Kategori dan Dompet dibuat lewat `createCategory`/`createWallet` sehingga
 * item penjaga keunikan (`UNIQ#...`) ikut tertulis. Ini memperbaiki celah
 * pada trigger lama yang menulis langsung tanpa penjaga, sehingga Dompet
 * bernama "Tunai" dahulu masih bisa dibuat ganda oleh Pengguna.
 *
 * Idempotensi: pemanggilan ulang menelan `NAME_TAKEN` dari penjaga keunikan
 * dan `ConditionalCheckFailedException` dari `attribute_not_exists(id)`,
 * sehingga aman dipanggil setiap aplikasi dibuka.
 *
 * _Requirements: 3.1, 1.2_
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { CategoryType } from 'shared/domain';
import {
  createCategory,
  createWallet,
  WalletCategoryOperationError,
  type IdFactory,
} from './operations-wallet-category';
import type { ItemRecord, LedgerRepo } from './repository';

// --- Data bawaan ----------------------------------------------------------

interface BuiltInCategory {
  name: string;
  type: CategoryType;
}

/**
 * Kategori bawaan berbahasa Indonesia. Nama unik per jenis, sehingga
 * "Lainnya" boleh muncul pada pengeluaran dan pemasukan sekaligus
 * (penjaga keunikan Kategori dipisah per jenis).
 */
export const BUILT_IN_CATEGORIES: readonly BuiltInCategory[] = [
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

/** Nama Dompet bawaan. */
export const TUNAI_WALLET_NAME = 'Tunai';

// --- Galat ----------------------------------------------------------------

export type BootstrapCode = 'SUB_REQUIRED' | 'TABLES_NOT_WIRED';

/** Galat operasi penyiapan data awal, berpesan bahasa Indonesia. */
export class BootstrapError extends Error {
  readonly code: BootstrapCode;

  constructor(code: BootstrapCode, message: string) {
    super(message);
    this.name = 'BootstrapError';
    this.code = code;
  }
}

// --- Penulis UserProfile dan NotifPrefs -----------------------------------

/**
 * Penulis item untuk dua tabel yang tidak dimodelkan `LedgerRepo`
 * (`UserProfile` dan `NotifPrefs`). Mengikuti pola `defaultPrefsLoader`
 * pada `handler.ts`, yang juga membaca `NotifPrefs` di luar repositori.
 */
export interface BootstrapStore {
  putIfAbsent(table: string, item: Record<string, unknown>): Promise<void>;
}

export interface BootstrapTables {
  profile: string;
  prefs: string;
}

/** Membaca nama tabel `UserProfile` dan `NotifPrefs` dari lingkungan. */
export function bootstrapTablesFromEnv(env: NodeJS.ProcessEnv = process.env): BootstrapTables {
  const profile = env.USERPROFILE_TABLE_NAME;
  const prefs = env.NOTIFPREFS_TABLE_NAME;
  if (!profile || !prefs) {
    throw new BootstrapError(
      'TABLES_NOT_WIRED',
      'Tabel profil atau preferensi notifikasi belum dirangkai',
    );
  }
  return { profile, prefs };
}

let sharedClient: DynamoDBDocumentClient | undefined;

function getClient(): DynamoDBDocumentClient {
  if (!sharedClient) {
    sharedClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    });
  }
  return sharedClient;
}

/** Mengosongkan klien bersama. Dipakai pengujian. */
export function resetBootstrapClient(): void {
  sharedClient = undefined;
}

/**
 * Penulis bawaan: `PutItem` dengan `attribute_not_exists(id)`.
 * `ConditionalCheckFailedException` ditelan (item sudah ada -> idempoten).
 */
export const defaultBootstrapStore: BootstrapStore = {
  async putIfAbsent(table, item) {
    try {
      await getClient().send(
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
  },
};

/** Atribut dasar yang ditambahkan Amplify pada setiap item model. */
function baseAttributes(typename: string, owner: string, nowIso: string): Record<string, unknown> {
  return {
    __typename: typename,
    owner,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

/**
 * Membersihkan baris penjaga keunikan lama yang masih membawa `owner`.
 *
 * Baris penjaga tinggal di tabel model yang sama dengan rekaman nyata. Versi
 * sebelumnya menuliskannya dengan `owner`, sehingga kueri AppSync
 * `listWallets`/`listCategories` ikut mengembalikannya dan GraphQL gagal:
 *
 *     Cannot return null for non-nullable type: 'String'
 *     within parent 'Wallet' (/listWallets/items[1]/name)
 *
 * Penulisan baru sudah tanpa `owner` (lihat `guardItem`), tetapi data yang
 * sudah tersimpan perlu diperbaiki. Baris ditulis ulang dengan `id` saja,
 * tanpa prasyarat, sehingga `owner` terhapus. Keunikan tidak terganggu karena
 * barisnya tetap ada; yang hilang hanya atribut `owner`.
 *
 * Bersifat idempoten: setelah bersih, `repo.list` tidak lagi mengembalikan
 * baris penjaga sehingga pemanggilan berikutnya tidak menemukan apa pun.
 */
async function repairLegacyGuards(repo: LedgerRepo, owner: string): Promise<number> {
  let repaired = 0;
  for (const entity of ['Wallet', 'Category'] as const) {
    const rows = await repo.list(entity, owner);
    for (const row of rows) {
      if (!row.id.startsWith('UNIQ#')) continue;
      await repo.put(entity, { id: row.id } as ItemRecord);
      repaired += 1;
    }
  }
  return repaired;
}

/** `true` bila galat berasal dari penjaga keunikan nama. */
function isNameTaken(err: unknown): boolean {
  return err instanceof WalletCategoryOperationError && err.code === 'NAME_TAKEN';
}

// --- Operasi --------------------------------------------------------------

export interface BootstrapInput {
  /** `sub` Cognito; menjadi id `UserProfile` dan `NotifPrefs`. */
  sub?: string | undefined;
  /** Nama tampilan awal; boleh kosong. */
  displayName?: string | undefined;
}

export interface BootstrapOptions {
  newId?: IdFactory;
  /** Penulis `UserProfile`/`NotifPrefs`. Default memakai DynamoDB. */
  store?: BootstrapStore;
  /** Nama tabel; default dibaca dari `process.env`. */
  tables?: BootstrapTables;
  /** Sumber waktu, agar uji bersifat deterministik. */
  now?: () => string;
}

export interface BootstrapResult {
  owner: string;
  /** Jumlah Kategori bawaan yang baru dibuat pada pemanggilan ini. */
  categoriesCreated: number;
  /** Jumlah Kategori bawaan yang sudah ada sebelumnya. */
  categoriesAlreadyPresent: number;
  /** `true` bila Dompet "Tunai" baru dibuat pada pemanggilan ini. */
  walletCreated: boolean;
  /** Jumlah baris penjaga keunikan lama yang dibersihkan. */
  guardsRepaired: number;
}

/**
 * Menyiapkan data awal Pengguna. Aman dipanggil berulang: hasilnya sama,
 * hanya jumlah yang "baru dibuat" yang berbeda.
 */
export async function bootstrapUser(
  repo: LedgerRepo,
  owner: string,
  input: BootstrapInput,
  options: BootstrapOptions = {},
): Promise<BootstrapResult> {
  const sub = (input.sub ?? '').trim();
  if (!sub) {
    throw new BootstrapError('SUB_REQUIRED', 'Identitas pengguna tidak memuat sub');
  }

  const store = options.store ?? defaultBootstrapStore;
  const tables = options.tables ?? bootstrapTablesFromEnv();
  const nowIso = (options.now ?? (() => new Date().toISOString()))();
  const displayName = (input.displayName ?? '').trim();

  // Dibersihkan lebih dulu agar daftar Dompet/Kategori kembali dapat dibaca
  // klien pada pemanggilan yang sama.
  const guardsRepaired = await repairLegacyGuards(repo, owner);

  // UserProfile dan NotifPrefs — satu item per Pengguna (id = sub).
  await store.putIfAbsent(tables.profile, {
    ...baseAttributes('UserProfile', owner, nowIso),
    id: sub,
    displayName,
  });

  await store.putIfAbsent(tables.prefs, {
    ...baseAttributes('NotifPrefs', owner, nowIso),
    id: sub,
    budget: true,
    recurring: true,
    goal: true,
    insight: true,
  });

  // Kategori bawaan.
  let categoriesCreated = 0;
  let categoriesAlreadyPresent = 0;
  for (const cat of BUILT_IN_CATEGORIES) {
    try {
      await createCategory(
        repo,
        owner,
        { name: cat.name, type: cat.type },
        { newId: options.newId, builtIn: true },
      );
      categoriesCreated += 1;
    } catch (err) {
      if (isNameTaken(err)) {
        categoriesAlreadyPresent += 1;
        continue;
      }
      throw err;
    }
  }

  // Dompet "Tunai" saldo 0.
  let walletCreated = false;
  try {
    await createWallet(
      repo,
      owner,
      { name: TUNAI_WALLET_NAME, initialBalance: 0 },
      { newId: options.newId },
    );
    walletCreated = true;
  } catch (err) {
    if (!isNameTaken(err)) throw err;
  }

  return { owner, categoriesCreated, categoriesAlreadyPresent, walletCreated, guardsRepaired };
}