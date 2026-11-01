/**
 * Lambda `recurring-runner` (Requirement 6.2, 6.3, 6.4, 6.5, 6.6).
 *
 * Dijalankan terjadwal setiap hari 00:05 WIB (EventBridge Scheduler,
 * `scheduleExpressionTimezone: 'Asia/Jakarta'`). Untuk setiap aturan
 * Transaksi_Berulang yang `ACTIVE` dan sudah jatuh tempo (`nextDueOn <=
 * today`), fungsi ini membuat Transaksi secara idempoten. Lihat design.md
 * bagian "Lambda `recurring-runner`":
 *
 * > Untuk setiap aturan: `dueOccurrences` (batas 366), lalu per jatuh tempo
 * > satu transaksi atomik: Put Transaction dengan ID `rec:<ruleId>:<dueDate>`
 * > (`attribute_not_exists`) + Update Wallet, lalu pembaruan aturan dengan
 * > kondisi `nextIndex = :expected`. Eksekusi ulang tidak menggandakan
 * > Transaksi (Req 6.6). Notifikasi pengingat `recrem:<ruleId>:<dueDate>`
 * > untuk H-3. Aturan yang dijeda atau dihapus dilewati (Req 6.4).
 *
 * Idempotensi (Property 12) dijaga oleh satu `TransactWriteItems` atomik per
 * jatuh tempo yang menggabungkan:
 * 1. Put Transaksi `rec:<ruleId>:<dueDate>` dengan prasyarat
 *    `attribute_not_exists(id)` — penulisan kedua gagal sehingga Transaksi
 *    tidak pernah tergandakan.
 * 2. Update saldo Dompet (`ADD balance`) — hanya berjalan bila Put di atas
 *    berhasil, jadi saldo berubah tepat satu kali per jatuh tempo.
 * 3. Update aturan (`nextIndex = index + 1`) dengan prasyarat
 *    `nextIndex = :expected` — memajukan penanda secara atomik.
 *
 * Karena ketiganya atomik, kegagalan prasyarat mana pun membatalkan seluruh
 * perubahan, sehingga eksekusi ulang pada hari yang sama tidak pernah
 * menggandakan Transaksi maupun mengubah saldo dua kali.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import {
  dueOccurrences,
  formatDateId,
  occurrence,
  reminderDue,
  toJakartaDate,
} from 'shared/domain';
import type { NotifPrefs, RuleLike } from 'shared/domain';
import {
  ConditionalCheckError,
  createLedgerRepo,
  type ItemRecord,
  type LedgerRepo,
  type RecurringRuleRecord,
  type TransactionRecord,
  type WriteOp,
} from '../ledger/repository';
import { createNotification, evaluateBudgetThresholds } from '../ledger/notifications';

// --- Hasil ----------------------------------------------------------------

/** Ringkasan pemrosesan satu aturan berulang. */
export interface ProcessRuleResult {
  ruleId: string;
  /** Transaksi baru yang benar-benar dibuat pada eksekusi ini. */
  created: number;
  /** Jatuh tempo yang dilewati karena Transaksinya sudah ada (idempoten). */
  skipped: number;
  /** `true` bila Notifikasi pengingat H-3 baru dibuat pada eksekusi ini. */
  reminderCreated: boolean;
}

/** Ringkasan satu eksekusi penuh `recurring-runner`. */
export interface RecurringRunResult {
  rulesProcessed: number;
  created: number;
  skipped: number;
  reminders: number;
}

// --- Util -----------------------------------------------------------------

/** Mengubah rekaman aturan menjadi `RuleLike` untuk fungsi domain murni. */
function toRuleLike(rule: RecurringRuleRecord): RuleLike {
  return {
    id: rule.id,
    frequency: rule.frequency,
    startDate: rule.startDate,
    nextIndex: rule.nextIndex,
    status: rule.status,
  };
}

/** ID Transaksi deterministik untuk jatuh tempo berulang (Req 6.6). */
export function recurringTxnId(ruleId: string, dueDate: string): string {
  return `rec:${ruleId}:${dueDate}`;
}

function budgetKey(categoryId: string, month: string): string {
  return `${categoryId}\u0000${month}`;
}

// --- Pemrosesan satu aturan ----------------------------------------------

/**
 * Memproses satu aturan berulang: membuat Transaksi untuk setiap jatuh tempo
 * (`dueOccurrences`, dibatasi 366 per eksekusi), menyesuaikan saldo Dompet,
 * memajukan `nextIndex`, lalu mengevaluasi ambang Anggaran (untuk pengeluaran)
 * dan membuat Notifikasi pengingat H-3 bila perlu.
 *
 * Seluruh penulisan saldo per jatuh tempo berjalan dalam satu
 * `TransactWriteItems` atomik dengan prasyarat `attribute_not_exists` pada
 * Transaksi, sehingga aman dipanggil berulang pada hari yang sama tanpa
 * menggandakan data (Property 12, Requirement 6.2, 6.4, 6.6).
 */
export async function processRule(
  repo: LedgerRepo,
  rule: RecurringRuleRecord,
  today: string,
  prefs?: NotifPrefs | null,
): Promise<ProcessRuleResult> {
  const result: ProcessRuleResult = { ruleId: rule.id, created: 0, skipped: 0, reminderCreated: false };

  // Aturan dijeda (atau bukan ACTIVE) tidak menghasilkan Transaksi (Req 6.4).
  if (rule.status !== 'ACTIVE') {
    return result;
  }

  const occurrences = dueOccurrences(toRuleLike(rule), today);
  const delta = rule.type === 'EXPENSE' ? -rule.amount : rule.amount;
  const affectedBudgets = new Map<string, { categoryId: string; month: string }>();

  // Penanda aturan yang diketahui saat ini (dimajukan tiap jatuh tempo).
  let currentIndex = rule.nextIndex;

  for (const occ of occurrences) {
    const month = occ.date.slice(0, 7);
    const nextIndex = occ.index + 1;
    const txn: TransactionRecord = {
      id: recurringTxnId(rule.id, occ.date),
      owner: rule.owner,
      type: rule.type,
      amount: rule.amount,
      date: occ.date,
      month,
      categoryId: rule.categoryId,
      walletId: rule.walletId,
      recurringRuleId: rule.id,
    };

    const ops: WriteOp[] = [
      { op: 'put', entity: 'Transaction', item: txn as unknown as ItemRecord, condition: { kind: 'notExists' } },
      { op: 'update', entity: 'Wallet', id: rule.walletId, add: { balance: delta } },
      {
        op: 'update',
        entity: 'RecurringRule',
        id: rule.id,
        set: {
          nextIndex,
          nextDueOn: occurrence(rule.startDate, rule.frequency, nextIndex),
        },
        condition: { kind: 'equals', attribute: 'nextIndex', value: occ.index },
      },
    ];

    try {
      await repo.transactWrite(ops);
      result.created += 1;
      currentIndex = nextIndex;
      if (rule.type === 'EXPENSE' && rule.categoryId) {
        affectedBudgets.set(budgetKey(rule.categoryId, month), { categoryId: rule.categoryId, month });
      }
    } catch (err) {
      // Prasyarat gagal berarti Transaksi untuk jatuh tempo ini sudah ada
      // (eksekusi ulang) atau penanda aturan sudah dimajukan oleh eksekusi
      // lain. Keduanya aman: tidak ada perubahan yang diterapkan.
      if (err instanceof ConditionalCheckError) {
        result.skipped += 1;
        continue;
      }
      throw err;
    }
  }

  // Evaluasi ambang Anggaran sekali per (Kategori, bulan) yang terpengaruh
  // pengeluaran baru (Requirement 5.4, 5.5).
  for (const { categoryId, month } of affectedBudgets.values()) {
    await evaluateBudgetThresholds(repo, rule.owner, { categoryId, month }, prefs);
  }

  // Notifikasi pengingat H-3 untuk jatuh tempo berikutnya (Requirement 6.5).
  // Dihitung pada keadaan aturan setelah dimajukan agar menunjuk jatuh tempo
  // yang belum lewat.
  const advanced: RuleLike = { ...toRuleLike(rule), nextIndex: currentIndex };
  const reminder = reminderDue(advanced, today);
  if (reminder) {
    const notif = await createNotification(
      repo,
      rule.owner,
      'recrem',
      `${rule.id}:${reminder.date}`,
      {
        title: 'Pengingat transaksi berulang',
        body: `Transaksi berulang akan jatuh tempo pada ${formatDateId(reminder.date)} (3 hari lagi).`,
        refId: rule.id,
      },
      prefs,
    );
    result.reminderCreated = notif.created;
  }

  return result;
}

/**
 * Memproses sekumpulan aturan berulang dan merangkum hasilnya. `prefsByOwner`
 * opsional memetakan pemilik ke preferensi Notifikasi; pemilik tanpa entri
 * dianggap mengaktifkan seluruh jenis Notifikasi (bawaan).
 */
export async function runRecurringRules(
  repo: LedgerRepo,
  rules: readonly RecurringRuleRecord[],
  today: string,
  prefsByOwner?: Map<string, NotifPrefs | null>,
): Promise<RecurringRunResult> {
  const summary: RecurringRunResult = { rulesProcessed: 0, created: 0, skipped: 0, reminders: 0 };
  for (const rule of rules) {
    const prefs = prefsByOwner?.get(rule.owner) ?? null;
    const res = await processRule(repo, rule, today, prefs);
    summary.rulesProcessed += 1;
    summary.created += res.created;
    summary.skipped += res.skipped;
    if (res.reminderCreated) summary.reminders += 1;
  }
  return summary;
}

// --- Sumber aturan jatuh tempo (produksi) --------------------------------

let sharedDocClient: DynamoDBDocumentClient | undefined;

function getDocClient(): DynamoDBDocumentClient {
  if (!sharedDocClient) {
    sharedDocClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    });
  }
  return sharedDocClient;
}

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Variabel lingkungan ${key} belum diset`);
  }
  return value;
}

/** Nama variabel lingkungan tabel yang dipakai sumber aturan dan preferensi. */
export const RECURRING_RULE_TABLE_ENV = 'RECURRING_RULE_TABLE_NAME';
export const NOTIFPREFS_TABLE_ENV = 'NOTIFPREFS_TABLE_NAME';

/**
 * Memindai seluruh aturan berulang `ACTIVE` dengan `nextDueOn <= today` dari
 * tabel RecurringRule (lintas pemilik, dijalankan terjadwal tanpa identitas
 * Pengguna). Aturan tanpa `nextDueOn` tetap diperhitungkan agar penanda yang
 * belum terisi tidak terlewat.
 */
async function scanDueRules(
  client: DynamoDBDocumentClient,
  tableName: string,
  today: string,
): Promise<RecurringRuleRecord[]> {
  const rules: RecurringRuleRecord[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const out = await client.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: '#status = :active AND (attribute_not_exists(#due) OR #due <= :today)',
        ExpressionAttributeNames: { '#status': 'status', '#due': 'nextDueOn' },
        ExpressionAttributeValues: { ':active': 'ACTIVE', ':today': today },
        ExclusiveStartKey: lastKey,
      }),
    );
    for (const item of out.Items ?? []) {
      rules.push(item as RecurringRuleRecord);
    }
    lastKey = out.LastEvaluatedKey;
  } while (lastKey);
  return rules;
}

/** Membaca preferensi Notifikasi (`NotifPrefs`) pemilik; `null` bila tidak ada. */
async function getPrefsForOwner(
  client: DynamoDBDocumentClient,
  tableName: string,
  owner: string,
): Promise<NotifPrefs | null> {
  const sub = owner.split('::')[0];
  if (!sub) return null;
  const out = await client.send(new GetCommand({ TableName: tableName, Key: { id: sub } }));
  const item = out.Item;
  if (!item || item.owner !== owner) return null;
  return {
    budget: item.budget as boolean | undefined,
    recurring: item.recurring as boolean | undefined,
    goal: item.goal as boolean | undefined,
    insight: item.insight as boolean | undefined,
  };
}

// --- Entry point Lambda ---------------------------------------------------

/**
 * Entry point terjadwal. Memindai aturan jatuh tempo lintas pemilik, membaca
 * preferensi Notifikasi per pemilik, lalu memproses setiap aturan secara
 * idempoten. Mengembalikan ringkasan agar mudah diamati di log.
 */
export const handler = async (): Promise<RecurringRunResult> => {
  const today = toJakartaDate(new Date());
  const repo = createLedgerRepo();
  const client = getDocClient();

  const ruleTable = requireEnv(RECURRING_RULE_TABLE_ENV);
  const prefsTable = requireEnv(NOTIFPREFS_TABLE_ENV);

  const rules = await scanDueRules(client, ruleTable, today);

  const prefsByOwner = new Map<string, NotifPrefs | null>();
  for (const rule of rules) {
    if (!prefsByOwner.has(rule.owner)) {
      prefsByOwner.set(rule.owner, await getPrefsForOwner(client, prefsTable, rule.owner));
    }
  }

  return runRecurringRules(repo, rules, today, prefsByOwner);
};
