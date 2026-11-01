import { type ClientSchema, a, defineData } from '@aws-amplify/backend';
import { ledger } from '../functions/ledger/resource';
import { aiGateway } from '../functions/ai-gateway/resource';

/**
 * Skema data Arto.
 *
 * Seluruh model memakai `allow.owner()` (Requirement 1.6, 1.8, 16.2):
 * setiap Pengguna hanya dapat membaca/mengubah datanya sendiri, dan tanpa
 * mode otorisasi publik atau API key (lihat `authorizationMode` di bawah).
 *
 * Model yang memengaruhi saldo (Wallet, Transaction) dan progres Target
 * (Goal) bersifat baca-saja bagi klien (`to(['read'])`): satu-satunya jalur
 * penulisan adalah custom mutation yang dijalankan lewat Lambda `ledger`,
 * sehingga perubahan saldo selalu melalui `TransactWriteItems` atomik
 * (Requirement 1.7).
 *
 * Custom mutation/query `ledger` dan `ai-gateway` memakai
 * `allow.authenticated()` pada level skema; verifikasi identitas yang
 * sebenarnya (menolak `event.identity` kosong, lalu menurunkan `owner`
 * lewat `ownerOf`) dilakukan di dalam masing-masing handler
 * (Requirement 1.6, 16.2).
 */
const schema = a.schema({
  UserProfile: a
    .model({
      displayName: a.string(),
      createdAt: a.datetime(),
    })
    .authorization((allow) => [allow.owner().to(['read', 'update'])]),

  Wallet: a
    .model({
      name: a.string().required(),
      nameKey: a.string().required(),
      initialBalance: a.integer().required(),
      balance: a.integer().required(),
    })
    // Mutation bawaan dimatikan; nama create/update/delete dipakai custom mutation.
    .disableOperations(['mutations'])
    .authorization((allow) => [allow.owner().to(['read'])]),

  Category: a
    .model({
      name: a.string().required(),
      nameKey: a.string().required(),
      type: a.enum(['EXPENSE', 'INCOME']),
      builtIn: a.boolean(),
    })
    // Mutation bawaan dimatikan; nama create/update/delete dipakai custom mutation.
    .disableOperations(['mutations'])
    .authorization((allow) => [allow.owner().to(['read'])]),

  Transaction: a
    .model({
      type: a.enum(['EXPENSE', 'INCOME', 'TRANSFER_OUT', 'TRANSFER_IN']),
      amount: a.integer().required(),
      date: a.string().required(),
      month: a.string().required(),
      categoryId: a.id(),
      walletId: a.id().required(),
      note: a.string(),
      searchText: a.string(),
      receiptKey: a.string(),
      recurringRuleId: a.id(),
      // Dideklarasikan secara eksplisit agar dapat dipakai sebagai kunci
      // partisi indeks sekunder di bawah. `allow.owner()` tetap mengisi
      // dan memvalidasi kolom ini secara otomatis saat Transaksi dibuat,
      // sehingga tidak ada definisi ganda yang bertentangan.
      owner: a.string(),
    })
    // Mutation bawaan dimatikan; nama create/update/delete dipakai custom mutation.
    .disableOperations(['mutations'])
    // Daftar Transaksi tak hingga diurutkan menurun berdasarkan tanggal
    // lewat kueri `listTxByDate` (Requirement 2.5).
    .secondaryIndexes((index) => [
      index('owner').sortKeys(['date']).queryField('listTxByDate'),
    ])
    .authorization((allow) => [allow.owner().to(['read'])]),

  Budget: a
    .model({
      categoryId: a.id().required(),
      month: a.string().required(),
      amount: a.integer().required(),
      warn80Sent: a.boolean(),
      over100Sent: a.boolean(),
    })
    .authorization((allow) => [allow.owner().to(['read'])]),

  RecurringRule: a
    .model({
      amount: a.integer().required(),
      categoryId: a.id().required(),
      walletId: a.id().required(),
      type: a.enum(['EXPENSE', 'INCOME']),
      frequency: a.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']),
      startDate: a.string().required(),
      nextIndex: a.integer().required(),
      nextDueOn: a.string(),
      status: a.enum(['ACTIVE', 'PAUSED']),
    })
    // Mutation bawaan dimatikan; nama create/update/delete dipakai custom mutation.
    .disableOperations(['mutations'])
    // `recurring-runner` memilih aturan jatuh tempo lewat `listRulesDue`
    // (status = ACTIVE, nextDueOn <= today) (Requirement 6.2, 6.3).
    .secondaryIndexes((index) => [
      index('status').sortKeys(['nextDueOn']).queryField('listRulesDue'),
    ])
    .authorization((allow) => [allow.owner().to(['read'])]),

  Goal: a
    .model({
      name: a.string().required(),
      target: a.integer().required(),
      saved: a.integer().required(),
      deadline: a.string(),
      achieved: a.boolean(),
    })
    // Mutation bawaan dimatikan; nama create/update/delete dipakai custom mutation.
    .disableOperations(['mutations'])
    .authorization((allow) => [allow.owner().to(['read'])]),

  Notification: a
    .model({
      type: a.string().required(),
      refId: a.string(),
      title: a.string().required(),
      body: a.string(),
      read: a.boolean(),
      createdAt: a.datetime(),
    })
    // Klien menandai Notifikasi sudah dibaca langsung (Requirement 9.2),
    // sedangkan pembuatan Notifikasi hanya berasal dari Lambda terjadwal
    // atau `ledger` lewat kredensial fungsi.
    .authorization((allow) => [allow.owner().to(['read', 'update'])]),

  NotifPrefs: a
    .model({
      budget: a.boolean(),
      recurring: a.boolean(),
      goal: a.boolean(),
      insight: a.boolean(),
    })
    .authorization((allow) => [allow.owner()]),

  PushSubscription: a
    .model({
      endpoint: a.string().required(),
      keys: a.json(),
    })
    .authorization((allow) => [allow.owner()]),

  WeeklyInsight: a
    .model({
      weekStart: a.string().required(),
      totalExpense: a.integer(),
      topCategoryId: a.id(),
      summary: a.string(),
      tips: a.string().array(),
    })
    .authorization((allow) => [allow.owner().to(['read'])]),

  // --- Custom mutation untuk Lambda `ledger` ---
  // Setiap operasi memetakan satu field GraphQL ke router di dalam
  // `ledger/handler.ts` (Requirement 2.1-2.4, 3.2-3.5, 4.1-4.5, 5.1, 5.6,
  // 6.1, 6.4, 7.1, 7.2, 7.4, 7.6). Argumen dan hasil memakai JSON agar
  // bentuk payload tetap dikendalikan dan divalidasi di dalam handler.
  /**
   * Menyiapkan data awal akun secara idempoten: `UserProfile`, `NotifPrefs`,
   * Kategori bawaan, dan Dompet "Tunai". Dipanggil frontend sekali setelah
   * masuk, menggantikan trigger Cognito `post-confirmation` yang dilepas
   * karena menimbulkan dependensi sirkular antar nested stack
   * (`auth` -> fungsi trigger -> `data` -> `auth`).
   *
   * Argumen `input` opsional; `displayName` boleh dikirim, dan bila kosong
   * handler memakai klaim `email` dari token.
   */
  bootstrapUser: a
    .mutation()
    .arguments({ input: a.json() })
    .returns(a.json())
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(ledger)),

  saveTransaction: a
    .mutation()
    .arguments({ input: a.json().required() })
    .returns(a.json())
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(ledger)),

  deleteTransaction: a
    .mutation()
    .arguments({ input: a.json().required() })
    .returns(a.json())
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(ledger)),

  transferFunds: a
    .mutation()
    .arguments({ input: a.json().required() })
    .returns(a.json())
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(ledger)),

  depositToGoal: a
    .mutation()
    .arguments({ input: a.json().required() })
    .returns(a.json())
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(ledger)),

  createWallet: a
    .mutation()
    .arguments({ input: a.json().required() })
    .returns(a.json())
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(ledger)),

  renameWallet: a
    .mutation()
    .arguments({ input: a.json().required() })
    .returns(a.json())
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(ledger)),

  deleteWalletWithReassign: a
    .mutation()
    .arguments({ input: a.json().required() })
    .returns(a.json())
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(ledger)),

  createCategory: a
    .mutation()
    .arguments({ input: a.json().required() })
    .returns(a.json())
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(ledger)),

  renameCategory: a
    .mutation()
    .arguments({ input: a.json().required() })
    .returns(a.json())
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(ledger)),

  deleteCategoryWithReassign: a
    .mutation()
    .arguments({ input: a.json().required() })
    .returns(a.json())
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(ledger)),

  upsertBudget: a
    .mutation()
    .arguments({ input: a.json().required() })
    .returns(a.json())
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(ledger)),

  copyBudgetsFromPreviousMonth: a
    .mutation()
    .arguments({ input: a.json().required() })
    .returns(a.json())
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(ledger)),

  createRecurringRule: a
    .mutation()
    .arguments({ input: a.json().required() })
    .returns(a.json())
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(ledger)),

  updateRecurringRule: a
    .mutation()
    .arguments({ input: a.json().required() })
    .returns(a.json())
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(ledger)),

  deleteRecurringRule: a
    .mutation()
    .arguments({ input: a.json().required() })
    .returns(a.json())
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(ledger)),

  createGoal: a
    .mutation()
    .arguments({ input: a.json().required() })
    .returns(a.json())
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(ledger)),

  updateGoal: a
    .mutation()
    .arguments({ input: a.json().required() })
    .returns(a.json())
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(ledger)),

  deleteGoal: a
    .mutation()
    .arguments({ input: a.json().required() })
    .returns(a.json())
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(ledger)),

  // --- Custom mutation untuk Lambda `ai-gateway` ---
  // Identitas kosong ditolak dan pembatas pemakaian (30/jam) diterapkan
  // sebelum memanggil Bedrock di dalam handler (Requirement 10.1-10.7,
  // 11.1-11.5, 12.1-12.4, 16.1-16.3).
  parseNaturalInput: a
    .mutation()
    .arguments({ input: a.json().required() })
    .returns(a.json())
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(aiGateway)),

  createReceiptUpload: a
    .mutation()
    .arguments({ input: a.json().required() })
    .returns(a.json())
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(aiGateway)),

  scanReceipt: a
    .mutation()
    .arguments({ input: a.json().required() })
    .returns(a.json())
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(aiGateway)),

  askAssistant: a
    .mutation()
    .arguments({ input: a.json().required() })
    .returns(a.json())
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(aiGateway)),
});

export type Schema = ClientSchema<typeof schema>;

/**
 * Mode otorisasi default adalah Cognito user pool: tanpa API key dan tanpa
 * akses publik (IAM/`allow.guest()`) pada level data (Requirement 1.6,
 * 1.8, 16.2).
 */
export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
  },
});
