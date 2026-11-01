/**
 * Helper Notifikasi, Web Push, dan evaluasi ambang Anggaran untuk Lambda
 * `ledger` (Requirement 5.4, 5.5, 9.1, 9.4, 9.5). Lihat design.md bagian
 * "Lambda `ledger`":
 *
 * > Setelah perubahan pengeluaran, evaluator ambang memakai
 * > `thresholdCrossings`, lalu `createNotification` (ID deterministik,
 * > `attribute_not_exists`) dan set `warn80Sent`/`over100Sent`. Web Push
 * > memakai `web-push`, langganan status 404/410 dihapus.
 *
 * Modul ini hanya berisi helper murni di atas {@link LedgerRepo} plus
 * pembungkus `web-push`. Operasi transaksi dan perangkaian handler berada di
 * berkas lain (tugas 7.3 sampai 7.6); modul ini tidak mengubah repositori.
 *
 * Idempotensi "satu Notifikasi per rujukan per bulan" (Property 9, Property
 * 26) dijaga oleh dua lapis:
 * 1. ID Notifikasi deterministik (`notificationId`) ditulis dengan prasyarat
 *    `attribute_not_exists(id)`, sehingga penulisan kedua gagal dengan
 *    {@link ConditionalCheckError}.
 * 2. Penanda `warn80Sent`/`over100Sent` pada Anggaran mencegah evaluasi ulang
 *    membuat Notifikasi untuk ambang yang sudah terlampaui pada bulan itu.
 */
import webpush from 'web-push';
import { monthlySpent, thresholdCrossings } from 'shared/domain/budget';
import { notificationId, shouldCreate } from 'shared/domain/notify';
import type { Budget, NotifPrefs, Txn } from 'shared/domain';
import {
  ConditionalCheckError,
  type BudgetRecord,
  type ItemRecord,
  type LedgerRepo,
  type NotificationRecord,
} from './repository';

// --- Notifikasi -----------------------------------------------------------

/** Muatan Notifikasi yang ditulis bersama ID deterministik. */
export interface NotificationPayload {
  title: string;
  body?: string;
  /** Rujukan entitas terkait (mis. `budgetId`). Default memakai `ref`. */
  refId?: string;
}

/** Hasil pemanggilan {@link createNotification}. */
export interface CreateNotificationResult {
  /** ID deterministik Notifikasi (`<type>:<ref>`). */
  id: string;
  /** `true` bila Notifikasi baru benar-benar ditulis. */
  created: boolean;
  /** Alasan Notifikasi tidak dibuat (bila `created` `false`). */
  reason?: 'prefs-disabled' | 'already-exists';
  /** Rekaman yang ditulis (hanya bila `created` `true`). */
  record?: NotificationRecord;
}

const NO_EXISTING_IDS: ReadonlySet<string> = new Set<string>();

/**
 * createNotification: membuat satu Notifikasi dengan ID deterministik
 * (`notificationId(type, ref)`) dan prasyarat `attribute_not_exists` sehingga
 * tidak pernah tergandakan (Requirement 9.1).
 *
 * - Preferensi Pengguna (`prefs`) yang menonaktifkan jenis Notifikasi membuat
 *   fungsi melewati penulisan (Requirement 9.5), ditandai dengan
 *   `reason: 'prefs-disabled'`.
 * - Bila Notifikasi dengan ID sama sudah ada, penulisan gagal secara
 *   kondisional dan fungsi mengembalikan `reason: 'already-exists'` tanpa
 *   melempar galat.
 */
export async function createNotification(
  repo: LedgerRepo,
  owner: string,
  type: string,
  ref: string,
  payload: NotificationPayload,
  prefs: NotifPrefs | null | undefined,
): Promise<CreateNotificationResult> {
  const id = notificationId(type, ref);

  // existingIds kosong: keputusan "sudah ada" diserahkan ke prasyarat
  // attribute_not_exists pada penulisan, sehingga `shouldCreate` hanya menilai
  // preferensi Pengguna di sini.
  if (!shouldCreate(type, prefs, NO_EXISTING_IDS as Set<string>, id)) {
    return { id, created: false, reason: 'prefs-disabled' };
  }

  const record: NotificationRecord = {
    id,
    owner,
    type,
    refId: payload.refId ?? ref,
    title: payload.title,
    body: payload.body,
    read: false,
  };

  try {
    await repo.put('Notification', record as unknown as ItemRecord, { kind: 'notExists' });
    return { id, created: true, record };
  } catch (err) {
    if (err instanceof ConditionalCheckError) {
      return { id, created: false, reason: 'already-exists' };
    }
    throw err;
  }
}

// --- Web Push -------------------------------------------------------------

/** Kunci enkripsi langganan Web Push (format standar `PushSubscription`). */
export interface WebPushKeys {
  p256dh: string;
  auth: string;
}

/**
 * Langganan Web Push sebagaimana disimpan pada model `PushSubscription`
 * (Requirement 9.4). `keys` dapat kosong/parsial bila data rusak; langganan
 * seperti itu dilewati.
 */
export interface StoredPushSubscription {
  /** ID rekaman `PushSubscription` (untuk penghapusan oleh pemanggil). */
  id?: string;
  endpoint: string;
  keys?: { p256dh?: string | null; auth?: string | null } | null;
}

/** Isi Notifikasi push yang dikirim ke peramban. */
export interface WebPushMessage {
  title: string;
  body?: string;
  /** Data tambahan (mis. tautan dalam aplikasi) yang diteruskan apa adanya. */
  data?: Record<string, unknown>;
}

/** Konfigurasi VAPID untuk autentikasi pengirim Web Push. */
export interface VapidConfig {
  subject: string;
  publicKey: string;
  privateKey: string;
}

/** Galat dari klien push; `statusCode` dipakai mengenali langganan kedaluwarsa. */
export interface PushSendError {
  statusCode?: number;
}

/**
 * Abstraksi klien push agar pengiriman dapat diuji tanpa jaringan. Implementasi
 * bawaan membungkus pustaka `web-push`.
 */
export interface PushClient {
  sendNotification(
    subscription: { endpoint: string; keys: WebPushKeys },
    payload: string,
  ): Promise<unknown>;
}

/** Ringkasan hasil pengiriman Web Push ke sekumpulan langganan. */
export interface WebPushResult {
  /** Endpoint langganan yang berhasil dikirimi. */
  sent: string[];
  /**
   * Endpoint langganan yang kedaluwarsa (HTTP 404/410) dan harus dihapus oleh
   * pemanggil (Requirement 9.4).
   */
  expired: string[];
  /** Endpoint yang gagal karena galat lain (dibiarkan, tidak dihapus). */
  failed: Array<{ endpoint: string; statusCode?: number }>;
}

/** Awalan variabel lingkungan untuk konfigurasi VAPID. */
export const VAPID_ENV_KEYS = {
  subject: 'VAPID_SUBJECT',
  publicKey: 'VAPID_PUBLIC_KEY',
  privateKey: 'VAPID_PRIVATE_KEY',
} as const;

/** Membaca konfigurasi VAPID dari lingkungan; `null` bila belum lengkap. */
export function vapidFromEnv(env: NodeJS.ProcessEnv = process.env): VapidConfig | null {
  const subject = env[VAPID_ENV_KEYS.subject]?.trim() || 'mailto:arto@example.com';
  const publicKey = env[VAPID_ENV_KEYS.publicKey]?.trim();
  const privateKey = env[VAPID_ENV_KEYS.privateKey]?.trim();
  if (!publicKey || !privateKey) return null;
  return { subject, publicKey, privateKey };
}

function createDefaultPushClient(vapid: VapidConfig): PushClient {
  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  return {
    sendNotification: (subscription, payload) => webpush.sendNotification(subscription, payload),
  };
}

function statusCodeOf(err: unknown): number | undefined {
  const code = (err as PushSendError | null)?.statusCode;
  return typeof code === 'number' ? code : undefined;
}

/** Langganan dianggap kedaluwarsa (harus dihapus) pada status 404 dan 410. */
export function isExpiredPushStatus(statusCode: number | undefined): boolean {
  return statusCode === 404 || statusCode === 410;
}

function hasKeys(sub: StoredPushSubscription): sub is StoredPushSubscription & { keys: WebPushKeys } {
  return Boolean(sub.keys?.p256dh && sub.keys?.auth && sub.endpoint);
}

/**
 * sendWebPush: mengirim satu Notifikasi push ke setiap langganan
 * (Requirement 9.4). Langganan yang mengembalikan HTTP 404/410 dikumpulkan di
 * `expired` agar pemanggil dapat menghapusnya; galat lain dicatat di `failed`
 * tanpa menghentikan pengiriman ke langganan lainnya.
 *
 * Klien push dapat disuntikkan lewat `options.client` untuk pengujian. Tanpa
 * konfigurasi VAPID yang lengkap dan tanpa klien tersuntik, seluruh langganan
 * dianggap `failed` (tidak ada pengiriman nyata).
 */
export async function sendWebPush(
  subscriptions: readonly StoredPushSubscription[],
  message: WebPushMessage,
  options: { client?: PushClient; vapid?: VapidConfig | null } = {},
): Promise<WebPushResult> {
  const result: WebPushResult = { sent: [], expired: [], failed: [] };
  if (subscriptions.length === 0) return result;

  let client = options.client;
  if (!client) {
    const vapid = options.vapid ?? vapidFromEnv();
    if (!vapid) {
      for (const sub of subscriptions) {
        result.failed.push({ endpoint: sub.endpoint });
      }
      return result;
    }
    client = createDefaultPushClient(vapid);
  }

  const payload = JSON.stringify({ title: message.title, body: message.body, data: message.data });

  for (const sub of subscriptions) {
    if (!hasKeys(sub)) {
      result.failed.push({ endpoint: sub.endpoint });
      continue;
    }
    try {
      await client.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload);
      result.sent.push(sub.endpoint);
    } catch (err) {
      const statusCode = statusCodeOf(err);
      if (isExpiredPushStatus(statusCode)) {
        result.expired.push(sub.endpoint);
      } else {
        result.failed.push({ endpoint: sub.endpoint, statusCode });
      }
    }
  }

  return result;
}

// --- Evaluasi ambang Anggaran ---------------------------------------------

/** Awalan jenis Notifikasi ambang Anggaran. */
export const BUDGET_WARN_TYPE = 'budget80';
export const BUDGET_OVER_TYPE = 'over100';

/** Satu Notifikasi ambang yang dihasilkan evaluasi Anggaran. */
export interface BudgetThresholdNotification {
  type: typeof BUDGET_WARN_TYPE | typeof BUDGET_OVER_TYPE;
  result: CreateNotificationResult;
}

/** Hasil {@link evaluateBudgetThresholds}. */
export interface BudgetThresholdResult {
  /** `false` bila tidak ada Anggaran untuk Kategori dan bulan tersebut. */
  evaluated: boolean;
  budget?: BudgetRecord;
  spent?: number;
  warn80: boolean;
  over100: boolean;
  /** Penanda yang baru diset `true` pada rekaman Anggaran. */
  flagsSet: Array<'warn80Sent' | 'over100Sent'>;
  /** Notifikasi yang diproses (dibuat atau dilewati). */
  notifications: BudgetThresholdNotification[];
}

const WARN_PAYLOAD: NotificationPayload = {
  title: 'Anggaran mendekati batas',
  body: 'Pengeluaran kategori ini sudah mencapai 80 persen dari anggaran bulan ini.',
};

const OVER_PAYLOAD: NotificationPayload = {
  title: 'Anggaran terlampaui',
  body: 'Pengeluaran kategori ini sudah melampaui anggaran bulan ini.',
};

function asTxn(record: { type: string; amount: number; date: string; categoryId?: string; walletId: string; id: string }): Txn {
  return {
    id: record.id,
    type: record.type as Txn['type'],
    amount: record.amount,
    date: record.date,
    categoryId: record.categoryId,
    walletId: record.walletId,
  };
}

function toBudget(record: BudgetRecord): Budget {
  return {
    id: record.id,
    categoryId: record.categoryId,
    month: record.month,
    amount: record.amount,
    warn80Sent: record.warn80Sent,
    over100Sent: record.over100Sent,
  };
}

/**
 * evaluateBudgetThresholds: setelah perubahan pengeluaran pada Kategori
 * `categoryId` bulan `month` (WIB), menghitung realisasi, memakai
 * `thresholdCrossings`, lalu membuat Notifikasi ambang 80 persen dan/atau 100
 * persen sekali per bulan (Requirement 5.4, 5.5).
 *
 * Penanda `warn80Sent`/`over100Sent` pada Anggaran diset `true` saat ambang
 * baru terlampaui (belum pernah ditandai), mencegah evaluasi berikutnya
 * membuat Notifikasi ulang (Property 9). Preferensi Notifikasi tetap dihormati
 * lewat {@link createNotification}; penanda tetap diset agar ambang yang sudah
 * terlampaui tidak dievaluasi ulang bila preferensi diaktifkan lagi.
 */
export async function evaluateBudgetThresholds(
  repo: LedgerRepo,
  owner: string,
  input: { categoryId: string; month: string },
  prefs: NotifPrefs | null | undefined,
): Promise<BudgetThresholdResult> {
  const budgets = await repo.list('Budget', owner, { categoryId: input.categoryId, month: input.month });
  const budget = budgets[0];
  if (!budget) {
    return { evaluated: false, warn80: false, over100: false, flagsSet: [], notifications: [] };
  }

  const txns = await repo.list('Transaction', owner, { month: input.month });
  const spent = monthlySpent(txns.map(asTxn), input.categoryId, input.month);
  const { warn80, over100 } = thresholdCrossings(toBudget(budget), spent);

  const flagsSet: BudgetThresholdResult['flagsSet'] = [];
  const notifications: BudgetThresholdNotification[] = [];
  const budgetSet: Record<string, unknown> = {};

  if (warn80 && !budget.warn80Sent) {
    const result = await createNotification(
      repo,
      owner,
      BUDGET_WARN_TYPE,
      budget.id,
      { ...WARN_PAYLOAD, refId: budget.id },
      prefs,
    );
    notifications.push({ type: BUDGET_WARN_TYPE, result });
    budgetSet.warn80Sent = true;
    flagsSet.push('warn80Sent');
  }

  if (over100 && !budget.over100Sent) {
    const result = await createNotification(
      repo,
      owner,
      BUDGET_OVER_TYPE,
      budget.id,
      { ...OVER_PAYLOAD, refId: budget.id },
      prefs,
    );
    notifications.push({ type: BUDGET_OVER_TYPE, result });
    budgetSet.over100Sent = true;
    flagsSet.push('over100Sent');
  }

  if (flagsSet.length > 0) {
    await repo.update('Budget', budget.id, { set: budgetSet });
  }

  return {
    evaluated: true,
    budget,
    spent,
    warn80,
    over100,
    flagsSet,
    notifications,
  };
}
