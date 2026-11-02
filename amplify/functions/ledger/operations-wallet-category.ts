/**
 * Operasi Dompet dan Kategori untuk Lambda `ledger` (tugas 7.4). Lihat
 * design.md bagian "Lambda `ledger`":
 *
 * | Operasi | Isi atomik (`TransactWriteItems`) |
 * |---------|-----------------------------------|
 * | `createWallet`/`renameWallet`/`deleteWalletWithReassign` | Item penjaga `UNIQ#<owner>#WALLET#<nameKey>`; reassign dipotong 25 item, idempoten |
 * | `createCategory`/`renameCategory`/`deleteCategoryWithReassign` | Penjaga `UNIQ#<owner>#<type>#<nameKey>`; kode `NEEDS_REPLACEMENT`; hapus Anggaran Kategori (K-6) |
 *
 * Keunikan nama (tanpa membedakan huruf besar kecil dan spasi tepi) dijaga
 * oleh item penjaga `UNIQ#<owner>#<type>#<nameKey>` yang ditulis dengan
 * prasyarat `attribute_not_exists(id)` dalam transaksi yang sama dengan entitas
 * (Requirement 3.3, 4.1, Property 22). Kegagalan prasyarat tersebut
 * (`ConditionalCheckError`) dipetakan ke pesan berbahasa Indonesia
 * "Nama sudah dipakai".
 *
 * Penghapusan Dompet/Kategori yang masih memiliki Transaksi ditolak dengan
 * kode `NEEDS_REPLACEMENT` bila Pengguna belum memilih pengganti (Requirement
 * 3.5, 4.5). Bila pengganti diberikan, seluruh Transaksi dipindahkan ke
 * pengganti tanpa kehilangan. Untuk Dompet, saldo Dompet yang dihapus
 * dipindahkan ke pengganti sehingga total saldo seluruh Dompet tidak berubah.
 * Untuk Kategori, Anggaran milik Kategori yang dihapus ikut dihapus (K-6).
 *
 * Batas `TransactWriteItems` DynamoDB (100 item) membuat reassign dipotong
 * {@link REASSIGN_CHUNK_SIZE} item per transaksi; karena penyetelan `walletId`/
 * `categoryId` ke pengganti bersifat idempoten, operasi dapat dilanjutkan ulang
 * bila gagal di tengah jalan.
 *
 * Modul ini hanya menambah berkas baru; repositori, resource, helper
 * notifikasi, dan operasi transaksi tidak diubah.
 */
import { randomUUID } from 'node:crypto';
import type { CategoryType } from 'shared/domain';
import {
  ConditionalCheckError,
  type Condition,
  type EntityName,
  type ItemRecord,
  type LedgerRepo,
  type CategoryRecord,
  type WalletRecord,
  type WriteOp,
} from './repository';

// --- Galat operasi --------------------------------------------------------

export type WalletCategoryOperationCode =
  | 'NAME_REQUIRED'
  | 'NAME_TAKEN'
  | 'INITIAL_BALANCE_INVALID'
  | 'WALLET_NOT_FOUND'
  | 'CATEGORY_NOT_FOUND'
  | 'NEEDS_REPLACEMENT'
  | 'REPLACEMENT_INVALID';

/**
 * Galat operasi Dompet/Kategori dengan pesan berbahasa Indonesia siap tampil.
 * Pemanggil (`handler.ts`) dapat meneruskan `message` apa adanya dan memakai
 * `code` untuk alur UI (mis. `NEEDS_REPLACEMENT` memunculkan dialog pengganti).
 */
export class WalletCategoryOperationError extends Error {
  readonly code: WalletCategoryOperationCode;

  constructor(code: WalletCategoryOperationCode, message: string) {
    super(message);
    this.name = 'WalletCategoryOperationError';
    this.code = code;
  }
}

const NAME_TAKEN_MESSAGE = 'Nama sudah dipakai';

// --- Opsi dan util bersama ------------------------------------------------

/** Pembuat ID (dapat disuntik pada uji agar deterministik). */
export type IdFactory = () => string;

export interface WalletCategoryOptions {
  /** Pembuat ID untuk entitas baru. Default `crypto.randomUUID`. */
  newId?: IdFactory;
  /**
   * Menandai Kategori sebagai bawaan sistem (`builtIn: true`).
   *
   * Sengaja ditempatkan di opsi, bukan di `input`, sehingga hanya dapat
   * disetel oleh pemanggil internal (penyiapan data awal lewat
   * `bootstrapUser`). Handler AppSync hanya meneruskan `newId`, jadi klien
   * tidak dapat menandai Kategori miliknya sebagai bawaan.
   */
  builtIn?: boolean;
}

/** Batas item reassign per `TransactWriteItems` (design: potong 25 item). */
export const REASSIGN_CHUNK_SIZE = 25;

/**
 * Menormalkan nama menjadi kunci unik: huruf kecil, spasi tepi dibuang, dan
 * spasi ganda diringkas. Sepadan dengan `toNameKey` pada trigger
 * `post-confirmation` sehingga Kategori/Dompet bawaan dan kustom memakai
 * aturan keunikan yang sama.
 */
export function toNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** ID item penjaga keunikan untuk Dompet. */
export function walletGuardId(owner: string, nameKey: string): string {
  return `UNIQ#${owner}#WALLET#${nameKey}`;
}

/** ID item penjaga keunikan untuk Kategori (dipisah per jenis). */
export function categoryGuardId(owner: string, type: CategoryType, nameKey: string): string {
  return `UNIQ#${owner}#${type}#${nameKey}`;
}

/**
 * Membuat rekaman item penjaga keunikan: HANYA `id`, tanpa `owner`.
 *
 * `owner` sengaja tidak disertakan. Item penjaga tinggal di tabel model yang
 * sama dengan rekaman nyata, sehingga bila ia memiliki `owner` maka:
 *
 * 1. Kueri AppSync `listWallets`/`listCategories` (otorisasi berbasis pemilik
 *    menyaring dengan `owner = <pengguna>`) ikut mengembalikannya, lalu
 *    GraphQL gagal dengan "Cannot return null for non-nullable type: 'String'"
 *    karena item penjaga tidak punya `name`.
 * 2. `repo.list(entity, owner)` juga mengembalikannya, sehingga logika internal
 *    Lambda melihat rekaman semu yang bukan Dompet/Kategori sungguhan.
 *
 * Tanpa `owner`, kedua jalur itu tidak lagi menemukannya. Keunikan tetap
 * terjaga karena prasyaratnya `attribute_not_exists(id)` pada id deterministik
 * yang sudah memuat owner di dalam nilainya (`UNIQ#<owner>#...`).
 */
function guardItem(id: string): ItemRecord {
  return { id } as ItemRecord;
}

const NOT_EXISTS: Condition = { kind: 'notExists' };

/** Membelah sebuah larik menjadi potongan berukuran `size`. */
function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * Menjalankan `TransactWriteItems` dan memetakan kegagalan prasyarat penjaga
 * keunikan (`ConditionalCheckError`) ke pesan "Nama sudah dipakai".
 */
async function runGuardedWrite(repo: LedgerRepo, ops: readonly WriteOp[]): Promise<void> {
  try {
    await repo.transactWrite(ops);
  } catch (err) {
    if (err instanceof ConditionalCheckError) {
      throw new WalletCategoryOperationError('NAME_TAKEN', NAME_TAKEN_MESSAGE);
    }
    throw err;
  }
}

function requireName(name: string): string {
  const trimmed = (name ?? '').trim();
  if (trimmed.length === 0) {
    throw new WalletCategoryOperationError('NAME_REQUIRED', 'Nama tidak boleh kosong');
  }
  return trimmed;
}

// --- Operasi Dompet -------------------------------------------------------

export interface CreateWalletInput {
  name: string;
  /** Saldo awal bilangan bulat tidak negatif. */
  initialBalance: number;
}

/**
 * createWallet: menyimpan Dompet baru dengan nama unik dan saldo awal bilangan
 * bulat tidak negatif (Requirement 4.1). Item penjaga `UNIQ#<owner>#WALLET#
 * <nameKey>` dan rekaman Dompet ditulis dalam satu transaksi atomik; bila nama
 * (tanpa membedakan huruf besar kecil dan spasi tepi) sudah dipakai, penulisan
 * ditolak dengan pesan "Nama sudah dipakai".
 */
export async function createWallet(
  repo: LedgerRepo,
  owner: string,
  input: CreateWalletInput,
  options: WalletCategoryOptions = {},
): Promise<WalletRecord> {
  const name = requireName(input.name);
  if (!Number.isInteger(input.initialBalance) || input.initialBalance < 0) {
    throw new WalletCategoryOperationError(
      'INITIAL_BALANCE_INVALID',
      'Saldo awal harus berupa bilangan bulat tidak negatif',
    );
  }

  const nameKey = toNameKey(name);
  const id = (options.newId ?? randomUUID)();
  const record: WalletRecord = {
    id,
    owner,
    name,
    nameKey,
    initialBalance: input.initialBalance,
    balance: input.initialBalance,
  };

  await runGuardedWrite(repo, [
    { op: 'put', entity: 'Wallet', item: guardItem(walletGuardId(owner, nameKey)), condition: NOT_EXISTS },
    { op: 'put', entity: 'Wallet', item: record as unknown as ItemRecord, condition: NOT_EXISTS },
  ]);

  return record;
}

/** Memuat Dompet milik pemilik atau melempar `WALLET_NOT_FOUND`. */
async function requireWallet(repo: LedgerRepo, owner: string, id: string): Promise<WalletRecord> {
  const record = await repo.get('Wallet', owner, id);
  if (!record) {
    throw new WalletCategoryOperationError('WALLET_NOT_FOUND', 'Dompet tidak ditemukan');
  }
  return record;
}

export interface RenameWalletInput {
  id: string;
  name: string;
}

/**
 * renameWallet: mengubah nama Dompet (Requirement 4.1). Bila kunci nama
 * berubah, item penjaga lama dihapus dan penjaga baru ditulis dengan prasyarat
 * keunikan dalam satu transaksi atomik; nama ganda ditolak dengan
 * "Nama sudah dipakai". Transaksi dan Anggaran merujuk Dompet lewat `id`
 * sehingga otomatis menampilkan nama baru.
 */
export async function renameWallet(
  repo: LedgerRepo,
  owner: string,
  input: RenameWalletInput,
  _options: WalletCategoryOptions = {},
): Promise<WalletRecord> {
  const name = requireName(input.name);
  const wallet = await requireWallet(repo, owner, input.id);
  const newNameKey = toNameKey(name);

  if (newNameKey === wallet.nameKey) {
    // Kunci nama tidak berubah (hanya huruf besar kecil/spasi): cukup set nama.
    await repo.update('Wallet', wallet.id, { set: { name } });
    return { ...wallet, name };
  }

  await runGuardedWrite(repo, [
    { op: 'delete', entity: 'Wallet', id: walletGuardId(owner, wallet.nameKey) },
    { op: 'put', entity: 'Wallet', item: guardItem(walletGuardId(owner, newNameKey)), condition: NOT_EXISTS },
    { op: 'update', entity: 'Wallet', id: wallet.id, set: { name, nameKey: newNameKey } },
  ]);

  return { ...wallet, name, nameKey: newNameKey };
}

export interface DeleteWalletInput {
  id: string;
  /** Dompet pengganti untuk memindahkan Transaksi bila Dompet berisi Transaksi. */
  replacementWalletId?: string;
}

export interface DeleteWalletResult {
  /** `true` bila Dompet memang dihapus pada pemanggilan ini. */
  deleted: boolean;
  /** Jumlah Transaksi yang dipindahkan ke Dompet pengganti. */
  reassignedCount: number;
  /** ID Dompet pengganti (bila ada). */
  replacementWalletId?: string;
}

/**
 * deleteWalletWithReassign: menghapus Dompet (Requirement 4.5).
 *
 * - Dompet yang masih memiliki Transaksi tanpa pengganti ditolak dengan kode
 *   `NEEDS_REPLACEMENT` sehingga UI meminta Dompet pengganti.
 * - Dengan pengganti, seluruh Transaksi dipindahkan (`walletId` -> pengganti)
 *   dalam potongan {@link REASSIGN_CHUNK_SIZE} item yang idempoten, lalu saldo
 *   Dompet yang dihapus dipindahkan ke pengganti agar total saldo tidak
 *   berubah, diikuti penghapusan Dompet dan item penjaganya secara atomik.
 * - Pemanggilan ulang setelah Dompet terhapus bersifat idempoten
 *   (`deleted: false`).
 */
export async function deleteWalletWithReassign(
  repo: LedgerRepo,
  owner: string,
  input: DeleteWalletInput,
): Promise<DeleteWalletResult> {
  const wallet = await repo.get('Wallet', owner, input.id);
  if (!wallet) {
    // Idempoten: sudah terhapus pada pemanggilan sebelumnya.
    return { deleted: false, reassignedCount: 0 };
  }

  const txns = await repo.list('Transaction', owner, { walletId: input.id });

  if (txns.length > 0 && !input.replacementWalletId) {
    throw new WalletCategoryOperationError(
      'NEEDS_REPLACEMENT',
      'Pilih Dompet pengganti sebelum menghapus Dompet yang memiliki Transaksi',
    );
  }

  let replacement: WalletRecord | undefined;
  if (input.replacementWalletId) {
    if (input.replacementWalletId === input.id) {
      throw new WalletCategoryOperationError('REPLACEMENT_INVALID', 'Dompet pengganti tidak valid');
    }
    const found = await repo.get('Wallet', owner, input.replacementWalletId);
    if (!found) {
      throw new WalletCategoryOperationError('REPLACEMENT_INVALID', 'Dompet pengganti tidak ditemukan');
    }
    replacement = found;
  }

  // Pindahkan Transaksi ke Dompet pengganti dalam potongan yang idempoten.
  if (replacement) {
    for (const group of chunk(txns, REASSIGN_CHUNK_SIZE)) {
      const ops: WriteOp[] = group.map((txn) => ({
        op: 'update',
        entity: 'Transaction',
        id: txn.id,
        set: { walletId: replacement!.id },
      }));
      await repo.transactWrite(ops);
    }
  }

  // Langkah akhir atomik: pindahkan saldo ke pengganti, hapus Dompet + penjaga.
  const finalOps: WriteOp[] = [];
  if (replacement && wallet.balance !== 0) {
    finalOps.push({ op: 'update', entity: 'Wallet', id: replacement.id, add: { balance: wallet.balance } });
  }
  finalOps.push({ op: 'delete', entity: 'Wallet', id: wallet.id });
  finalOps.push({ op: 'delete', entity: 'Wallet', id: walletGuardId(owner, wallet.nameKey) });
  await repo.transactWrite(finalOps);

  return {
    deleted: true,
    reassignedCount: replacement ? txns.length : 0,
    replacementWalletId: replacement?.id,
  };
}

// --- Operasi Kategori -----------------------------------------------------

export interface CreateCategoryInput {
  name: string;
  type: CategoryType;
}

/**
 * createCategory: menyimpan Kategori kustom dengan nama unik per jenis
 * (Requirement 3.2, 3.3). Item penjaga `UNIQ#<owner>#<type>#<nameKey>` dan
 * rekaman Kategori ditulis atomik; nama ganda pada jenis yang sama ditolak
 * dengan "Nama sudah dipakai".
 */
export async function createCategory(
  repo: LedgerRepo,
  owner: string,
  input: CreateCategoryInput,
  options: WalletCategoryOptions = {},
): Promise<CategoryRecord> {
  const name = requireName(input.name);
  const nameKey = toNameKey(name);
  const id = (options.newId ?? randomUUID)();
  const record: CategoryRecord = {
    id,
    owner,
    name,
    nameKey,
    type: input.type,
    builtIn: options.builtIn ?? false,
  };

  await runGuardedWrite(repo, [
    {
      op: 'put',
      entity: 'Category',
      item: guardItem(categoryGuardId(owner, input.type, nameKey)),
      condition: NOT_EXISTS,
    },
    { op: 'put', entity: 'Category', item: record as unknown as ItemRecord, condition: NOT_EXISTS },
  ]);

  return record;
}

/** Memuat Kategori milik pemilik atau melempar `CATEGORY_NOT_FOUND`. */
async function requireCategory(repo: LedgerRepo, owner: string, id: string): Promise<CategoryRecord> {
  const record = await repo.get('Category', owner, id);
  if (!record) {
    throw new WalletCategoryOperationError('CATEGORY_NOT_FOUND', 'Kategori tidak ditemukan');
  }
  return record;
}

export interface RenameCategoryInput {
  id: string;
  name: string;
}

/**
 * renameCategory: mengubah nama Kategori (Requirement 3.4). Transaksi dan
 * Anggaran merujuk Kategori lewat `id` sehingga nama baru langsung tampil pada
 * seluruh entitas terkait. Bila kunci nama berubah, item penjaga (pada jenis
 * yang sama) diperbarui dengan prasyarat keunikan; nama ganda ditolak dengan
 * "Nama sudah dipakai".
 */
export async function renameCategory(
  repo: LedgerRepo,
  owner: string,
  input: RenameCategoryInput,
  _options: WalletCategoryOptions = {},
): Promise<CategoryRecord> {
  const name = requireName(input.name);
  const category = await requireCategory(repo, owner, input.id);
  const newNameKey = toNameKey(name);

  if (newNameKey === category.nameKey) {
    await repo.update('Category', category.id, { set: { name } });
    return { ...category, name };
  }

  await runGuardedWrite(repo, [
    { op: 'delete', entity: 'Category', id: categoryGuardId(owner, category.type, category.nameKey) },
    {
      op: 'put',
      entity: 'Category',
      item: guardItem(categoryGuardId(owner, category.type, newNameKey)),
      condition: NOT_EXISTS,
    },
    { op: 'update', entity: 'Category', id: category.id, set: { name, nameKey: newNameKey } },
  ]);

  return { ...category, name, nameKey: newNameKey };
}

export interface DeleteCategoryInput {
  id: string;
  /** Kategori pengganti untuk memindahkan Transaksi bila Kategori berisi Transaksi. */
  replacementCategoryId?: string;
}

export interface DeleteCategoryResult {
  /** `true` bila Kategori memang dihapus pada pemanggilan ini. */
  deleted: boolean;
  /** Jumlah Transaksi yang dipindahkan ke Kategori pengganti. */
  reassignedCount: number;
  /** Jumlah Anggaran milik Kategori yang ikut dihapus (K-6). */
  budgetsDeleted: number;
  /** ID Kategori pengganti (bila ada). */
  replacementCategoryId?: string;
}

/**
 * deleteCategoryWithReassign: menghapus Kategori (Requirement 3.5).
 *
 * - Kategori yang masih memiliki Transaksi tanpa pengganti ditolak dengan kode
 *   `NEEDS_REPLACEMENT`.
 * - Dengan pengganti (harus jenis yang sama), seluruh Transaksi dipindahkan
 *   (`categoryId` -> pengganti) dalam potongan {@link REASSIGN_CHUNK_SIZE} yang
 *   idempoten.
 * - Anggaran milik Kategori yang dihapus ikut dihapus (K-6), lalu Kategori dan
 *   item penjaganya dihapus secara atomik.
 * - Pemanggilan ulang setelah Kategori terhapus bersifat idempoten.
 */
export async function deleteCategoryWithReassign(
  repo: LedgerRepo,
  owner: string,
  input: DeleteCategoryInput,
): Promise<DeleteCategoryResult> {
  const category = await repo.get('Category', owner, input.id);
  if (!category) {
    return { deleted: false, reassignedCount: 0, budgetsDeleted: 0 };
  }

  const txns = await repo.list('Transaction', owner, { categoryId: input.id });

  if (txns.length > 0 && !input.replacementCategoryId) {
    throw new WalletCategoryOperationError(
      'NEEDS_REPLACEMENT',
      'Pilih Kategori pengganti sebelum menghapus Kategori yang memiliki Transaksi',
    );
  }

  let replacement: CategoryRecord | undefined;
  if (input.replacementCategoryId) {
    if (input.replacementCategoryId === input.id) {
      throw new WalletCategoryOperationError('REPLACEMENT_INVALID', 'Kategori pengganti tidak valid');
    }
    const found = await repo.get('Category', owner, input.replacementCategoryId);
    if (!found) {
      throw new WalletCategoryOperationError('REPLACEMENT_INVALID', 'Kategori pengganti tidak ditemukan');
    }
    if (found.type !== category.type) {
      throw new WalletCategoryOperationError(
        'REPLACEMENT_INVALID',
        'Kategori pengganti harus berjenis sama',
      );
    }
    replacement = found;
  }

  // Pindahkan Transaksi ke Kategori pengganti dalam potongan yang idempoten.
  if (replacement) {
    for (const group of chunk(txns, REASSIGN_CHUNK_SIZE)) {
      const ops: WriteOp[] = group.map((txn) => ({
        op: 'update',
        entity: 'Transaction',
        id: txn.id,
        set: { categoryId: replacement!.id },
      }));
      await repo.transactWrite(ops);
    }
  }

  // Hapus Anggaran milik Kategori (K-6) dalam potongan.
  const budgets = await repo.list('Budget', owner, { categoryId: input.id });
  for (const group of chunk(budgets, REASSIGN_CHUNK_SIZE)) {
    const ops: WriteOp[] = group.map((budget) => ({
      op: 'delete' as const,
      entity: 'Budget' as EntityName,
      id: budget.id,
    }));
    await repo.transactWrite(ops);
  }

  // Langkah akhir atomik: hapus Kategori + penjaga.
  await repo.transactWrite([
    { op: 'delete', entity: 'Category', id: category.id },
    { op: 'delete', entity: 'Category', id: categoryGuardId(owner, category.type, category.nameKey) },
  ]);

  return {
    deleted: true,
    reassignedCount: replacement ? txns.length : 0,
    budgetsDeleted: budgets.length,
    replacementCategoryId: replacement?.id,
  };
}
