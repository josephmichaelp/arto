/**
 * Fungsi domain murni untuk logika keuangan dasar: penerapan riwayat
 * operasi pada saldo Dompet dan rencana pemindahan dana antar Dompet.
 * Lihat design.md bagian "Modul domain murni" dan Properti 3-4.
 */
import type { Rupiah, Txn, TxnType, Wallet } from './types';

export type LedgerEvent =
  | { kind: 'create' | 'delete'; txn: Txn }
  | { kind: 'update'; before: Txn; after: Txn }
  | { kind: 'transfer'; from: string; to: string; amount: Rupiah }
  | { kind: 'goalDeposit'; walletId: string; amount: Rupiah };

export type TransferRejectCode = 'AMOUNT_INVALID' | 'INSUFFICIENT_BALANCE' | 'SAME_WALLET';

const INSUFFICIENT_BALANCE_MESSAGE = 'Saldo dompet asal tidak cukup';
const AMOUNT_INVALID_MESSAGE = 'Nominal harus berupa angka bulat lebih dari 0';
const SAME_WALLET_MESSAGE = 'Dompet asal dan tujuan harus berbeda';

/**
 * Tanda delta saldo Dompet untuk setiap jenis Transaksi.
 * EXPENSE dan TRANSFER_OUT dan GOAL_DEPOSIT mengurangi saldo; INCOME dan
 * TRANSFER_IN menambah saldo (K-3, K-4).
 */
function signedAmount(type: TxnType, amount: Rupiah): Rupiah {
  switch (type) {
    case 'INCOME':
    case 'TRANSFER_IN':
      return amount;
    case 'EXPENSE':
    case 'TRANSFER_OUT':
    case 'GOAL_DEPOSIT':
      return -amount;
    default:
      return 0;
  }
}

/** Mengembalikan salinan `wallets` dengan saldo `walletId` bertambah `delta`. */
function adjustBalance(wallets: Wallet[], walletId: string, delta: Rupiah): Wallet[] {
  if (delta === 0) {
    return wallets;
  }
  return wallets.map((w) => (w.id === walletId ? { ...w, balance: w.balance + delta } : w));
}

/**
 * Menerapkan satu peristiwa ledger pada daftar Dompet, mengembalikan salinan
 * baru dengan saldo yang sudah diperbarui.
 */
function applyEvent(wallets: Wallet[], event: LedgerEvent): Wallet[] {
  switch (event.kind) {
    case 'create':
      return adjustBalance(wallets, event.txn.walletId, signedAmount(event.txn.type, event.txn.amount));
    case 'delete':
      return adjustBalance(wallets, event.txn.walletId, -signedAmount(event.txn.type, event.txn.amount));
    case 'update': {
      const reverted = adjustBalance(
        wallets,
        event.before.walletId,
        -signedAmount(event.before.type, event.before.amount),
      );
      return adjustBalance(
        reverted,
        event.after.walletId,
        signedAmount(event.after.type, event.after.amount),
      );
    }
    case 'transfer': {
      const afterOut = adjustBalance(wallets, event.from, -event.amount);
      return adjustBalance(afterOut, event.to, event.amount);
    }
    case 'goalDeposit':
      return adjustBalance(wallets, event.walletId, -event.amount);
    default:
      return wallets;
  }
}

/**
 * Menerapkan urutan peristiwa ledger (buat/ubah/hapus Transaksi, transfer,
 * setoran Target) pada daftar Dompet secara berurutan.
 *
 * Properti 3: saldo setiap Dompet SHALL sama dengan saldo awal ditambah
 * total pemasukan dikurangi total pengeluaran dari Transaksi yang masih
 * ada (termasuk efek transfer dan setoran), dan menghapus Transaksi SHALL
 * mengembalikan saldo ke nilai sebelum Transaksi dibuat.
 */
export function applyEvents(wallets: Wallet[], events: LedgerEvent[]): Wallet[] {
  return events.reduce((acc, event) => applyEvent(acc, event), wallets);
}

/**
 * Merencanakan pemindahan dana `amount` dari Dompet `src` ke `dst`.
 *
 * Properti 4: transfer yang berhasil SHALL mengurangi Dompet asal dan
 * menambah Dompet tujuan dengan nominal yang sama (total saldo tidak
 * berubah). Ditolak bila `src` dan `dst` sama, bila nominal tidak lebih
 * dari 0, atau bila nominal melebihi saldo Dompet asal (K-4, Req 4.4, 7.6).
 */
export function planTransfer(
  src: Wallet,
  dst: Wallet,
  amount: Rupiah,
): { ok: true; src: Wallet; dst: Wallet } | { ok: false; code: TransferRejectCode; message: string } {
  if (src.id === dst.id) {
    return { ok: false, code: 'SAME_WALLET', message: SAME_WALLET_MESSAGE };
  }
  if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount <= 0) {
    return { ok: false, code: 'AMOUNT_INVALID', message: AMOUNT_INVALID_MESSAGE };
  }
  if (amount > src.balance) {
    return { ok: false, code: 'INSUFFICIENT_BALANCE', message: INSUFFICIENT_BALANCE_MESSAGE };
  }
  return {
    ok: true,
    src: { ...src, balance: src.balance - amount },
    dst: { ...dst, balance: dst.balance + amount },
  };
}
