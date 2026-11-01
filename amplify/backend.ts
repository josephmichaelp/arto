import { defineBackend } from '@aws-amplify/backend';
import { Stack } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { Function as LambdaFunction } from 'aws-cdk-lib/aws-lambda';
import { CfnSchedule } from 'aws-cdk-lib/aws-scheduler';

import { auth } from './auth/resource';
import { data } from './data/resource';
import { storage } from './storage/resource';
import { ledger } from './functions/ledger/resource';
import { aiGateway } from './functions/ai-gateway/resource';
import { recurringRunner } from './functions/recurring-runner/resource';
import { weeklyInsight } from './functions/weekly-insight/resource';

/**
 * Perangkaian backend Arto (Requirement 1.4, 6.2, 13.1, 16.1, 16.2).
 *
 * Berkas ini menyatukan auth, data, storage, dan lima fungsi Lambda, lalu
 * menambahkan sumber daya/kebijakan yang tidak dapat dinyatakan lewat
 * `define*` saja:
 *
 * - Tabel `AiUsage` khusus fungsi dengan TTL (`ttl`, 2 jam) untuk pembatas
 *   pemakaian AI (design.md "Lambda `ai-gateway`", Requirement 16.3).
 * - `preventUserExistenceErrors = 'ENABLED'` pada app client Cognito agar
 *   galat login tidak mengungkap keberadaan email (Requirement 1.4).
 * - Kebijakan IAM `bedrock:InvokeModel` untuk `ai-gateway` dan
 *   `weekly-insight` pada foundation model dan inference profile APAC,
 *   termasuk kondisi `bedrock:InferenceProfileArn` (design.md "IAM",
 *   Requirement 16.1).
 * - Akses S3 (awalan `receipts/`) dan DynamoDB (tabel aplikasi + `AiUsage`),
 *   plus variabel lingkungan nama tabel yang dibaca handler lewat
 *   `process.env` (`*_TABLE_NAME`, `AI_USAGE_TABLE_NAME`).
 * - Jadwal EventBridge Scheduler (`Asia/Jakarta`): harian 00:05 WIB ke
 *   `recurring-runner`, Senin 00:30 WIB ke `weekly-insight`
 *   (Requirement 6.2, 13.1).
 */
const backend = defineBackend({
  auth,
  data,
  storage,
  ledger,
  aiGateway,
  recurringRunner,
  weeklyInsight,
});

// --- Lambda dan tabel -------------------------------------------------------

// `resources.lambda` bertipe `IFunction`; sumber daya Amplify sebenarnya
// `NodejsFunction` (turunan `Function`), sehingga `addEnvironment`,
// `addToRolePolicy`, dan `grantInvoke` tersedia saat sintesis.
const ledgerFn = backend.ledger.resources.lambda as LambdaFunction;
const aiGatewayFn = backend.aiGateway.resources.lambda as LambdaFunction;
const recurringRunnerFn = backend.recurringRunner.resources.lambda as LambdaFunction;
const weeklyInsightFn = backend.weeklyInsight.resources.lambda as LambdaFunction;

const tables = backend.data.resources.tables;

/**
 * Nama variabel lingkungan nama tabel per model, sepadan dengan yang dibaca
 * handler (`amplify/functions/ledger/repository.ts` `TABLE_ENV_KEYS`,
 * `amplify/functions/ledger/operations-bootstrap.ts`). Nilai diisi dengan
 * `table.tableName` (token CDK) saat sintesis.
 */
const TABLE_ENV: Record<string, string> = {
  Wallet: 'WALLET_TABLE_NAME',
  Category: 'CATEGORY_TABLE_NAME',
  Transaction: 'TRANSACTION_TABLE_NAME',
  Budget: 'BUDGET_TABLE_NAME',
  RecurringRule: 'RECURRING_RULE_TABLE_NAME',
  Goal: 'GOAL_TABLE_NAME',
  Notification: 'NOTIFICATION_TABLE_NAME',
  UserProfile: 'USERPROFILE_TABLE_NAME',
  NotifPrefs: 'NOTIFPREFS_TABLE_NAME',
  PushSubscription: 'PUSHSUBSCRIPTION_TABLE_NAME',
  WeeklyInsight: 'WEEKLYINSIGHT_TABLE_NAME',
};

/** Tipe fungsi Lambda Amplify dengan akses CDK (addEnvironment, grants, IAM). */
type AmplifyLambda = typeof ledgerFn;

/**
 * Memberi fungsi akses baca/tulis ke tabel model dan memasang variabel
 * lingkungan nama tabelnya. `grantReadWriteData` mencakup `TransactWriteItems`,
 * `Get`, `Query`, `Scan`, `Put`, `Update`, dan `Delete`.
 */
function grantTable(fn: AmplifyLambda, model: string, mode: 'rw' | 'r'): void {
  const table = tables[model as keyof typeof tables];
  if (!table) return;
  if (mode === 'rw') table.grantReadWriteData(fn);
  else table.grantReadData(fn);
  const envKey = TABLE_ENV[model];
  if (envKey) fn.addEnvironment(envKey, table.tableName);
}

// Lambda `ledger`: seluruh tabel aplikasi yang memengaruhi saldo, langganan
// push, serta `UserProfile`/`NotifPrefs` untuk operasi `bootstrapUser`
// (penyiapan data awal akun, dulu dikerjakan trigger `post-confirmation`).
for (const model of [
  'Wallet',
  'Category',
  'Transaction',
  'Budget',
  'RecurringRule',
  'Goal',
  'Notification',
  'PushSubscription',
  'UserProfile',
  'NotifPrefs',
] as const) {
  grantTable(ledgerFn, model, 'rw');
}

// Lambda `recurring-runner`: memakai repositori yang sama dengan `ledger`
// (seluruh tujuh tabel wajib ada, lihat `tableNamesFromEnv`) plus langganan push.
for (const model of [
  'Wallet',
  'Category',
  'Transaction',
  'Budget',
  'RecurringRule',
  'Goal',
  'Notification',
  'PushSubscription',
] as const) {
  grantTable(recurringRunnerFn, model, 'rw');
}


// Lambda `weekly-insight`: memindai profil dan transaksi (baca), menulis
// Wawasan_Mingguan dan Notifikasi.
grantTable(weeklyInsightFn, 'UserProfile', 'r');
grantTable(weeklyInsightFn, 'Transaction', 'r');
grantTable(weeklyInsightFn, 'Category', 'r');
grantTable(weeklyInsightFn, 'WeeklyInsight', 'rw');
grantTable(weeklyInsightFn, 'Notification', 'rw');

// Lambda `ai-gateway`: membangun konteks `askAssistant` dari data Pengguna
// (baca) dan menulis struk tidak mengubah tabel aplikasi.
grantTable(aiGatewayFn, 'Transaction', 'r');
grantTable(aiGatewayFn, 'Category', 'r');
grantTable(aiGatewayFn, 'Budget', 'r');
grantTable(aiGatewayFn, 'Wallet', 'r');
grantTable(aiGatewayFn, 'Goal', 'r');

// --- Tabel AiUsage (khusus fungsi, dengan TTL) -----------------------------

// Tabel ini dibuat di dalam stack fungsi `ai-gateway` (bukan stack
// terpisah) untuk menghindari dependensi sirkular antar-stack:
// `grantReadWriteData` membuat stack tabel bergantung pada role fungsi,
// sementara `addEnvironment` membuat stack fungsi bergantung pada nama
// tabel. Keduanya kini intra-stack.

/**
 * Tabel pembatas pemakaian AI: kunci `USAGE#<sub>#<hourBucket>`, atribut
 * `count`, `ttl` (design.md, Requirement 16.3). TTL mengosongkan item lama
 * otomatis; `PAY_PER_REQUEST` karena pola akses berdurasi singkat dan jarang.
 */
const aiUsageTable = new dynamodb.Table(Stack.of(aiGatewayFn), 'AiUsageTable', {
  partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  timeToLiveAttribute: 'ttl',
});

aiUsageTable.grantReadWriteData(aiGatewayFn);
aiGatewayFn.addEnvironment('AI_USAGE_TABLE_NAME', aiUsageTable.tableName);

// --- S3 struk (awalan `receipts/`) ----------------------------------------

const receiptBucket = backend.storage.resources.bucket;
receiptBucket.grantReadWrite(aiGatewayFn, 'receipts/*');
aiGatewayFn.addEnvironment('RECEIPT_BUCKET_NAME', receiptBucket.bucketName);

// --- Cognito: preventUserExistenceErrors (Requirement 1.4) ----------------

backend.auth.resources.cfnResources.cfnUserPoolClient.preventUserExistenceErrors = 'ENABLED';

// --- IAM Bedrock (Requirement 16.1, design.md "IAM") ----------------------

const account = Stack.of(aiGatewayFn).account;

const NOVA_LITE_FOUNDATION_MODEL = 'arn:aws:bedrock:*::foundation-model/amazon.nova-lite-v1:0';
const INFERENCE_PROFILE_ARNS = [
  `arn:aws:bedrock:ap-southeast-3:${account}:inference-profile/apac.amazon.nova-lite-v1:0`,
  `arn:aws:bedrock:ap-southeast-1:${account}:inference-profile/apac.amazon.nova-lite-v1:0`,
];

/**
 * Menambahkan kebijakan Bedrock ke sebuah fungsi.
 *
 * - Pernyataan 1: panggilan langsung ke foundation model (kandidat C1,
 *   `amazon.nova-lite-v1:0` di region) dan ke kedua inference profile APAC
 *   (kandidat C2/C3) tanpa kondisi.
 * - Pernyataan 2: akses foundation model lintas region yang diperlukan saat
 *   panggilan dirutekan lewat inference profile, dibatasi kondisi
 *   `bedrock:InferenceProfileArn` ke profil APAC yang diizinkan.
 */
function grantBedrock(fn: AmplifyLambda): void {
  fn.addToRolePolicy(
    new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
      resources: [NOVA_LITE_FOUNDATION_MODEL, ...INFERENCE_PROFILE_ARNS],
    }),
  );
  fn.addToRolePolicy(
    new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
      resources: [NOVA_LITE_FOUNDATION_MODEL],
      conditions: {
        StringEquals: { 'bedrock:InferenceProfileArn': INFERENCE_PROFILE_ARNS },
      },
    }),
  );
}

grantBedrock(aiGatewayFn);
grantBedrock(weeklyInsightFn);

// --- EventBridge Scheduler (Asia/Jakarta) ---------------------------------

const scheduleStack = backend.createStack('ScheduleStack');

/**
 * Membuat jadwal EventBridge Scheduler yang memanggil `fn` memakai cron WIB.
 * Peran khusus hanya memiliki izin `lambda:InvokeFunction` pada fungsi target.
 */
function createSchedule(id: string, fn: AmplifyLambda, cron: string): void {
  const role = new iam.Role(scheduleStack, `${id}Role`, {
    assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
  });
  fn.grantInvoke(role);

  new CfnSchedule(scheduleStack, id, {
    flexibleTimeWindow: { mode: 'OFF' },
    scheduleExpression: cron,
    scheduleExpressionTimezone: 'Asia/Jakarta',
    target: {
      arn: fn.functionArn,
      roleArn: role.roleArn,
    },
  });
}

// Harian 00:05 WIB → recurring-runner (Requirement 6.2).
createSchedule('RecurringDaily', recurringRunnerFn, 'cron(5 0 * * ? *)');
// Senin 00:30 WIB → weekly-insight (Requirement 13.1).
createSchedule('WeeklyInsightMonday', weeklyInsightFn, 'cron(30 0 ? * MON *)');

export { backend };
