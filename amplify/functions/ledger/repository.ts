/**
 * Lapisan repositori Lambda `ledger` (Requirement 2.1, 6.6).
 *
 * Seluruh penulisan yang memengaruhi saldo berjalan lewat
 * `TransactWriteItems` DynamoDB yang atomik (lihat design.md bagian
 * "Lambda `ledger`"). Repositori diabstraksi lewat antarmuka `LedgerRepo`
 * dengan dua implementasi:
 *
 * - `DynamoLedgerRepo`: implementasi produksi memakai `@aws-sdk/client-dynamodb`
 *   dan `@aws-sdk/lib-dynamodb` (`DynamoDBDocumentClient`).
 * - `InMemoryLedgerRepo`: implementasi uji yang meniru semantik DynamoDB
 *   (penulisan kondisional, atomisitas semua-atau-tidak-sama-sekali, dan
 *   isolasi pemilik) tanpa jaringan.
 *
 * Setiap model Amplify (`Wallet`, `Category`, `Transaction`, `Budget`,
 * `RecurringRule`, `Goal`, `Notification`) adalah tabel DynamoDB tersendiri
 * dengan kunci partisi `id`. Kolom `owner` (`<sub>::<username>`) menyimpan
 * pemilik; seluruh operasi baca dibatasi ke pemilik yang diminta sehingga
 * data antar Pengguna tidak pernah bocor (Property 18, Requirement 1.6, 1.8).
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
  TransactWriteCommand,
  UpdateCommand,
  type TransactWriteCommandInput,
} from '@aws-sdk/lib-dynamodb';
import type { Frequency, RuleStatus, TxnType } from 'shared/domain';

// --- Nama entitas dan bentuk rekaman -------------------------------------

/** Model yang dikelola Lambda `ledger`. Satu entitas = satu tabel DynamoDB. */
export type EntityName =
  | 'Wallet'
  | 'Category'
  | 'Transaction'
  | 'Budget'
  | 'RecurringRule'
  | 'Goal'
  | 'Notification';

export const ENTITY_NAMES: readonly EntityName[] = [
  'Wallet',
  'Category',
  'Transaction',
  'Budget',
  'RecurringRule',
  'Goal',
  'Notification',
];

/** Kolom metadata yang dipakai bersama seluruh model Amplify. */
export interface BaseRecord {
  id: string;
  owner: string;
  /** Diisi otomatis oleh repositori saat `put` (ISO UTC). */
  createdAt?: string;
  updatedAt?: string;
  /** Nama model Amplify, diperlukan agar klien data dapat membaca item. */
  __typename?: string;
}

export interface WalletRecord extends BaseRecord {
  name: string;
  nameKey: string;
  initialBalance: number;
  balance: number;
}

export interface CategoryRecord extends BaseRecord {
  name: string;
  nameKey: string;
  type: 'EXPENSE' | 'INCOME';
  builtIn?: boolean;
}

export interface TransactionRecord extends BaseRecord {
  type: TxnType;
  amount: number;
  date: string;
  month: string;
  categoryId?: string;
  walletId: string;
  note?: string;
  searchText?: string;
  receiptKey?: string;
  recurringRuleId?: string;
}

export interface BudgetRecord extends BaseRecord {
  categoryId: string;
  month: string;
  amount: number;
  warn80Sent?: boolean;
  over100Sent?: boolean;
}

export interface RecurringRuleRecord extends BaseRecord {
  amount: number;
  categoryId: string;
  walletId: string;
  type: 'EXPENSE' | 'INCOME';
  frequency: Frequency;
  startDate: string;
  nextIndex: number;
  nextDueOn?: string;
  status: RuleStatus;
}

export interface GoalRecord extends BaseRecord {
  name: string;
  target: number;
  saved: number;
  deadline?: string;
  achieved?: boolean;
}

export interface NotificationRecord extends BaseRecord {
  type: string;
  refId?: string;
  title: string;
  body?: string;
  read?: boolean;
}

/** Peta entitas ke tipe rekamannya, untuk operasi baca yang terketik. */
export interface RecordByEntity {
  Wallet: WalletRecord;
  Category: CategoryRecord;
  Transaction: TransactionRecord;
  Budget: BudgetRecord;
  RecurringRule: RecurringRuleRecord;
  Goal: GoalRecord;
  Notification: NotificationRecord;
}

/** Rekaman generik: minimal memiliki `id` dan `owner`. */
export type ItemRecord = BaseRecord & Record<string, unknown>;

// --- Penulisan kondisional dan operasi tulis -----------------------------

/**
 * Prasyarat penulisan yang dipetakan ke `ConditionExpression` DynamoDB.
 *
 * - `notExists`: `attribute_not_exists(id)` — penjaga keunikan dan penulisan
 *   idempoten (mis. Transaksi berulang `rec:<ruleId>:<dueDate>`).
 * - `exists`: `attribute_exists(id)`.
 * - `numberGte`: `#attr >= value` — mis. `balance >= :amt` pada transfer dan
 *   setoran Target (Requirement 4.4, 7.6).
 * - `equals`: `#attr = value` — mis. `nextIndex = :expected` pada aturan
 *   berulang (Requirement 6.6).
 */
export type Condition =
  | { kind: 'notExists' }
  | { kind: 'exists' }
  | { kind: 'numberGte'; attribute: string; value: number }
  | { kind: 'equals'; attribute: string; value: unknown };

export type WriteOp =
  | { op: 'put'; entity: EntityName; item: ItemRecord; condition?: Condition }
  | {
      op: 'update';
      entity: EntityName;
      id: string;
      /** Set nilai absolut pada kolom. */
      set?: Record<string, unknown>;
      /** Tambah nilai numerik secara atomik (`ADD`), boleh negatif. */
      add?: Record<string, number>;
      /** Hapus kolom. */
      remove?: readonly string[];
      condition?: Condition;
    }
  | { op: 'delete'; entity: EntityName; id: string; condition?: Condition }
  | { op: 'check'; entity: EntityName; id: string; condition: Condition };

/** Opsi penyaring kesetaraan untuk `list` (konjungtif, dievaluasi atas pemilik). */
export type ListFilter = Record<string, unknown>;

// --- Galat ----------------------------------------------------------------

/**
 * Dilempar saat sebuah `ConditionExpression` gagal, baik pada penulisan
 * tunggal maupun pada `TransactWriteItems`. Pemanggil (operasi di
 * `handler.ts`) memetakannya ke pesan berbahasa Indonesia yang sesuai
 * (mis. "Saldo dompet asal tidak cukup" atau "Nama sudah dipakai").
 */
export class ConditionalCheckError extends Error {
  readonly code = 'CONDITIONAL_CHECK_FAILED';
  /** Indeks operasi yang gagal pada transaksi (bila diketahui). */
  readonly failedIndexes: readonly number[];

  constructor(message = 'Prasyarat penulisan tidak terpenuhi', failedIndexes: readonly number[] = []) {
    super(message);
    this.name = 'ConditionalCheckError';
    this.failedIndexes = failedIndexes;
  }
}

/** Mengenali kegagalan prasyarat dari galat SDK DynamoDB. */
export function isConditionalCheckFailure(err: unknown): boolean {
  const name = (err as { name?: unknown } | null)?.name;
  if (name === 'ConditionalCheckFailedException') return true;
  if (name === 'TransactionCanceledException') {
    const reasons = (err as { CancellationReasons?: Array<{ Code?: unknown }> }).CancellationReasons ?? [];
    return reasons.some((r) => r?.Code === 'ConditionalCheckFailed');
  }
  return false;
}

function failedIndexesFrom(err: unknown): number[] {
  const reasons = (err as { CancellationReasons?: Array<{ Code?: unknown }> } | null)?.CancellationReasons ?? [];
  const indexes: number[] = [];
  reasons.forEach((reason, index) => {
    if (reason?.Code === 'ConditionalCheckFailed') indexes.push(index);
  });
  return indexes;
}

// --- Antarmuka repositori -------------------------------------------------

/** Batas item `TransactWriteItems` DynamoDB per transaksi. */
export const MAX_TRANSACT_ITEMS = 100;

export interface LedgerRepo {
  /** Membaca satu item berdasarkan `id`, dibatasi pemilik. `null` bila tak ada atau bukan milik pemilik. */
  get<E extends EntityName>(entity: E, owner: string, id: string): Promise<RecordByEntity[E] | null>;

  /** Daftar seluruh item pemilik pada sebuah entitas, dengan penyaring kesetaraan opsional (konjungtif). */
  list<E extends EntityName>(entity: E, owner: string, filter?: ListFilter): Promise<RecordByEntity[E][]>;

  /** Penulisan tunggal (put) dengan prasyarat opsional. Metadata diisi otomatis. */
  put(entity: EntityName, item: ItemRecord, condition?: Condition): Promise<void>;

  /** Pembaruan tunggal (`SET`/`ADD`/`REMOVE`) dengan prasyarat opsional. */
  update(
    entity: EntityName,
    id: string,
    changes: { set?: Record<string, unknown>; add?: Record<string, number>; remove?: readonly string[] },
    condition?: Condition,
  ): Promise<void>;

  /** Penghapusan tunggal dengan prasyarat opsional. */
  delete(entity: EntityName, id: string, condition?: Condition): Promise<void>;

  /**
   * Menjalankan beberapa operasi tulis secara atomik (`TransactWriteItems`).
   * Bila salah satu prasyarat gagal, tidak ada perubahan yang diterapkan dan
   * `ConditionalCheckError` dilempar. Maksimal {@link MAX_TRANSACT_ITEMS} operasi.
   */
  transactWrite(ops: readonly WriteOp[]): Promise<void>;
}

// --- Util ekspresi (dipakai implementasi DynamoDB) -----------------------

const nowIso = (): string => new Date().toISOString();

/** Melengkapi item dengan metadata Amplify sebelum ditulis. */
function stampForPut(entity: EntityName, item: ItemRecord): ItemRecord {
  const ts = nowIso();
  return {
    ...item,
    __typename: item.__typename ?? entity,
    createdAt: item.createdAt ?? ts,
    updatedAt: ts,
  };
}

interface CompiledExpr {
  expression: string;
  names: Record<string, string>;
  values: Record<string, unknown>;
}

/** Mengompilasi `Condition` menjadi `ConditionExpression` dengan placeholder berawalan `c`. */
function compileCondition(condition: Condition): CompiledExpr {
  switch (condition.kind) {
    case 'notExists':
      return { expression: 'attribute_not_exists(#cid)', names: { '#cid': 'id' }, values: {} };
    case 'exists':
      return { expression: 'attribute_exists(#cid)', names: { '#cid': 'id' }, values: {} };
    case 'numberGte':
      return {
        expression: '#cattr >= :cval',
        names: { '#cattr': condition.attribute },
        values: { ':cval': condition.value },
      };
    case 'equals':
      return {
        expression: '#cattr = :cval',
        names: { '#cattr': condition.attribute },
        values: { ':cval': condition.value },
      };
    default: {
      const _exhaustive: never = condition;
      throw new Error(`Kondisi tidak dikenal: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

interface CompiledUpdate {
  updateExpression: string;
  names: Record<string, string>;
  values: Record<string, unknown>;
}

/** Membangun `UpdateExpression` (`SET`/`ADD`/`REMOVE`) termasuk `updatedAt`. */
function compileUpdate(changes: {
  set?: Record<string, unknown>;
  add?: Record<string, number>;
  remove?: readonly string[];
}): CompiledUpdate {
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const setParts: string[] = [];
  const addParts: string[] = [];
  const removeParts: string[] = [];

  let i = 0;
  for (const [key, value] of Object.entries(changes.set ?? {})) {
    const n = `#s${i}`;
    const v = `:s${i}`;
    names[n] = key;
    values[v] = value;
    setParts.push(`${n} = ${v}`);
    i += 1;
  }

  // Selalu perbarui updatedAt pada setiap perubahan.
  names['#updatedAt'] = 'updatedAt';
  values[':updatedAt'] = nowIso();
  setParts.push('#updatedAt = :updatedAt');

  let j = 0;
  for (const [key, delta] of Object.entries(changes.add ?? {})) {
    const n = `#a${j}`;
    const v = `:a${j}`;
    names[n] = key;
    values[v] = delta;
    addParts.push(`${n} ${v}`);
    j += 1;
  }

  let k = 0;
  for (const key of changes.remove ?? []) {
    const n = `#r${k}`;
    names[n] = key;
    removeParts.push(n);
    k += 1;
  }

  const clauses: string[] = [`SET ${setParts.join(', ')}`];
  if (addParts.length > 0) clauses.push(`ADD ${addParts.join(', ')}`);
  if (removeParts.length > 0) clauses.push(`REMOVE ${removeParts.join(', ')}`);

  return { updateExpression: clauses.join(' '), names, values };
}

function nonEmpty<T extends Record<string, unknown>>(obj: T): T | undefined {
  return Object.keys(obj).length > 0 ? obj : undefined;
}

// --- Resolusi nama tabel --------------------------------------------------

export type TableNames = Record<EntityName, string>;

/** Nama variabel lingkungan default untuk nama tabel tiap entitas. */
export const TABLE_ENV_KEYS: Record<EntityName, string> = {
  Wallet: 'WALLET_TABLE_NAME',
  Category: 'CATEGORY_TABLE_NAME',
  Transaction: 'TRANSACTION_TABLE_NAME',
  Budget: 'BUDGET_TABLE_NAME',
  RecurringRule: 'RECURRING_RULE_TABLE_NAME',
  Goal: 'GOAL_TABLE_NAME',
  Notification: 'NOTIFICATION_TABLE_NAME',
};

/**
 * Membangun peta nama tabel dari variabel lingkungan (disetel saat perangkaian
 * backend memberi Lambda akses ke tabel data). Melempar galat bila ada yang hilang.
 */
export function tableNamesFromEnv(env: NodeJS.ProcessEnv = process.env): TableNames {
  const result = {} as TableNames;
  for (const entity of ENTITY_NAMES) {
    const key = TABLE_ENV_KEYS[entity];
    const value = env[key];
    if (!value) {
      throw new Error(`Variabel lingkungan nama tabel hilang: ${key}`);
    }
    result[entity] = value;
  }
  return result;
}

// --- Implementasi DynamoDB ------------------------------------------------

let sharedDocClient: DynamoDBDocumentClient | undefined;

function getDocClient(): DynamoDBDocumentClient {
  if (!sharedDocClient) {
    sharedDocClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    });
  }
  return sharedDocClient;
}

/** Mengosongkan klien dokumen bersama. Dipakai pengujian. */
export function resetLedgerDocClient(): void {
  sharedDocClient = undefined;
}

export class DynamoLedgerRepo implements LedgerRepo {
  private readonly client: DynamoDBDocumentClient;
  private readonly tables: TableNames;

  constructor(options?: { client?: DynamoDBDocumentClient; tables?: TableNames }) {
    this.client = options?.client ?? getDocClient();
    this.tables = options?.tables ?? tableNamesFromEnv();
  }

  private tableFor(entity: EntityName): string {
    return this.tables[entity];
  }

  async get<E extends EntityName>(entity: E, owner: string, id: string): Promise<RecordByEntity[E] | null> {
    const out = await this.client.send(
      new GetCommand({ TableName: this.tableFor(entity), Key: { id } }),
    );
    const item = out.Item as RecordByEntity[E] | undefined;
    if (!item || item.owner !== owner) return null;
    return item;
  }

  async list<E extends EntityName>(entity: E, owner: string, filter?: ListFilter): Promise<RecordByEntity[E][]> {
    const names: Record<string, string> = { '#owner': 'owner' };
    const values: Record<string, unknown> = { ':owner': owner };
    const parts: string[] = ['#owner = :owner'];

    let i = 0;
    for (const [key, value] of Object.entries(filter ?? {})) {
      const n = `#f${i}`;
      const v = `:f${i}`;
      names[n] = key;
      values[v] = value;
      parts.push(`${n} = ${v}`);
      i += 1;
    }

    const items: RecordByEntity[E][] = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
      const out = await this.client.send(
        new ScanCommand({
          TableName: this.tableFor(entity),
          FilterExpression: parts.join(' AND '),
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
          ExclusiveStartKey: lastKey,
        }),
      );
      for (const item of out.Items ?? []) {
        items.push(item as RecordByEntity[E]);
      }
      lastKey = out.LastEvaluatedKey;
    } while (lastKey);

    return items;
  }

  async put(entity: EntityName, item: ItemRecord, condition?: Condition): Promise<void> {
    const stamped = stampForPut(entity, item);
    const compiled = condition ? compileCondition(condition) : undefined;
    try {
      await this.client.send(
        new PutCommand({
          TableName: this.tableFor(entity),
          Item: stamped,
          ConditionExpression: compiled?.expression,
          ExpressionAttributeNames: compiled ? nonEmpty(compiled.names) : undefined,
          ExpressionAttributeValues: compiled ? nonEmpty(compiled.values) : undefined,
        }),
      );
    } catch (err) {
      throw this.mapError(err);
    }
  }

  async update(
    entity: EntityName,
    id: string,
    changes: { set?: Record<string, unknown>; add?: Record<string, number>; remove?: readonly string[] },
    condition?: Condition,
  ): Promise<void> {
    const compiledUpdate = compileUpdate(changes);
    const compiledCondition = condition ? compileCondition(condition) : undefined;
    const names = { ...compiledUpdate.names, ...(compiledCondition?.names ?? {}) };
    const values = { ...compiledUpdate.values, ...(compiledCondition?.values ?? {}) };
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.tableFor(entity),
          Key: { id },
          UpdateExpression: compiledUpdate.updateExpression,
          ConditionExpression: compiledCondition?.expression,
          ExpressionAttributeNames: nonEmpty(names),
          ExpressionAttributeValues: nonEmpty(values),
        }),
      );
    } catch (err) {
      throw this.mapError(err);
    }
  }

  async delete(entity: EntityName, id: string, condition?: Condition): Promise<void> {
    const compiled = condition ? compileCondition(condition) : undefined;
    try {
      await this.client.send(
        new DeleteCommand({
          TableName: this.tableFor(entity),
          Key: { id },
          ConditionExpression: compiled?.expression,
          ExpressionAttributeNames: compiled ? nonEmpty(compiled.names) : undefined,
          ExpressionAttributeValues: compiled ? nonEmpty(compiled.values) : undefined,
        }),
      );
    } catch (err) {
      throw this.mapError(err);
    }
  }

  async transactWrite(ops: readonly WriteOp[]): Promise<void> {
    if (ops.length === 0) return;
    if (ops.length > MAX_TRANSACT_ITEMS) {
      throw new Error(`TransactWriteItems melebihi batas ${MAX_TRANSACT_ITEMS} operasi: ${ops.length}`);
    }

    const transactItems: NonNullable<TransactWriteCommandInput['TransactItems']> = ops.map((op) => {
      const table = this.tableFor(op.entity);
      switch (op.op) {
        case 'put': {
          const compiled = op.condition ? compileCondition(op.condition) : undefined;
          return {
            Put: {
              TableName: table,
              Item: stampForPut(op.entity, op.item),
              ConditionExpression: compiled?.expression,
              ExpressionAttributeNames: compiled ? nonEmpty(compiled.names) : undefined,
              ExpressionAttributeValues: compiled ? nonEmpty(compiled.values) : undefined,
            },
          };
        }
        case 'update': {
          const compiledUpdate = compileUpdate({ set: op.set, add: op.add, remove: op.remove });
          const compiledCondition = op.condition ? compileCondition(op.condition) : undefined;
          const names = { ...compiledUpdate.names, ...(compiledCondition?.names ?? {}) };
          const values = { ...compiledUpdate.values, ...(compiledCondition?.values ?? {}) };
          return {
            Update: {
              TableName: table,
              Key: { id: op.id },
              UpdateExpression: compiledUpdate.updateExpression,
              ConditionExpression: compiledCondition?.expression,
              ExpressionAttributeNames: nonEmpty(names),
              ExpressionAttributeValues: nonEmpty(values),
            },
          };
        }
        case 'delete': {
          const compiled = op.condition ? compileCondition(op.condition) : undefined;
          return {
            Delete: {
              TableName: table,
              Key: { id: op.id },
              ConditionExpression: compiled?.expression,
              ExpressionAttributeNames: compiled ? nonEmpty(compiled.names) : undefined,
              ExpressionAttributeValues: compiled ? nonEmpty(compiled.values) : undefined,
            },
          };
        }
        case 'check': {
          const compiled = compileCondition(op.condition);
          return {
            ConditionCheck: {
              TableName: table,
              Key: { id: op.id },
              ConditionExpression: compiled.expression,
              ExpressionAttributeNames: nonEmpty(compiled.names),
              ExpressionAttributeValues: nonEmpty(compiled.values),
            },
          };
        }
        default: {
          const _exhaustive: never = op;
          throw new Error(`Operasi tulis tidak dikenal: ${JSON.stringify(_exhaustive)}`);
        }
      }
    });

    try {
      await this.client.send(new TransactWriteCommand({ TransactItems: transactItems }));
    } catch (err) {
      throw this.mapError(err);
    }
  }

  private mapError(err: unknown): unknown {
    if (isConditionalCheckFailure(err)) {
      return new ConditionalCheckError(undefined, failedIndexesFrom(err));
    }
    return err;
  }
}

// --- Implementasi in-memory (uji) ----------------------------------------

/**
 * Repositori in-memory yang meniru semantik DynamoDB untuk uji: isolasi
 * pemilik, penulisan kondisional, dan atomisitas `TransactWriteItems`.
 */
export class InMemoryLedgerRepo implements LedgerRepo {
  private readonly tables: Map<EntityName, Map<string, ItemRecord>> = new Map();

  constructor(seed?: Partial<Record<EntityName, ItemRecord[]>>) {
    for (const entity of ENTITY_NAMES) {
      this.tables.set(entity, new Map());
    }
    if (seed) {
      for (const entity of ENTITY_NAMES) {
        for (const item of seed[entity] ?? []) {
          this.tableFor(entity).set(item.id, stampForPut(entity, item));
        }
      }
    }
  }

  private tableFor(entity: EntityName): Map<string, ItemRecord> {
    const table = this.tables.get(entity);
    if (!table) throw new Error(`Entitas tidak dikenal: ${entity}`);
    return table;
  }

  /** Cuplikan seluruh item sebuah entitas (uji). */
  dump<E extends EntityName>(entity: E): RecordByEntity[E][] {
    return [...this.tableFor(entity).values()].map((item) => ({ ...item })) as unknown as RecordByEntity[E][];
  }

  private evaluateCondition(entity: EntityName, id: string, condition: Condition): boolean {
    const item = this.tableFor(entity).get(id);
    switch (condition.kind) {
      case 'notExists':
        return item === undefined;
      case 'exists':
        return item !== undefined;
      case 'numberGte': {
        if (!item) return false;
        const value = item[condition.attribute];
        return typeof value === 'number' && value >= condition.value;
      }
      case 'equals': {
        if (!item) return false;
        return item[condition.attribute] === condition.value;
      }
      default: {
        const _exhaustive: never = condition;
        throw new Error(`Kondisi tidak dikenal: ${JSON.stringify(_exhaustive)}`);
      }
    }
  }

  private applyUpdate(
    entity: EntityName,
    id: string,
    changes: { set?: Record<string, unknown>; add?: Record<string, number>; remove?: readonly string[] },
  ): void {
    const table = this.tableFor(entity);
    const current = table.get(id);
    const next: ItemRecord = current ? { ...current } : ({ id, owner: '' } as ItemRecord);
    for (const [key, value] of Object.entries(changes.set ?? {})) {
      next[key] = value;
    }
    for (const [key, delta] of Object.entries(changes.add ?? {})) {
      const existing = next[key];
      next[key] = (typeof existing === 'number' ? existing : 0) + delta;
    }
    for (const key of changes.remove ?? []) {
      delete next[key];
    }
    next.updatedAt = nowIso();
    table.set(id, next);
  }

  async get<E extends EntityName>(entity: E, owner: string, id: string): Promise<RecordByEntity[E] | null> {
    const item = this.tableFor(entity).get(id);
    if (!item || item.owner !== owner) return null;
    return { ...item } as unknown as RecordByEntity[E];
  }

  async list<E extends EntityName>(entity: E, owner: string, filter?: ListFilter): Promise<RecordByEntity[E][]> {
    const entries = filter ? Object.entries(filter) : [];
    const result: RecordByEntity[E][] = [];
    for (const item of this.tableFor(entity).values()) {
      if (item.owner !== owner) continue;
      if (entries.every(([key, value]) => item[key] === value)) {
        result.push({ ...item } as unknown as RecordByEntity[E]);
      }
    }
    return result;
  }

  async put(entity: EntityName, item: ItemRecord, condition?: Condition): Promise<void> {
    if (condition && !this.evaluateCondition(entity, item.id, condition)) {
      throw new ConditionalCheckError(undefined, [0]);
    }
    this.tableFor(entity).set(item.id, stampForPut(entity, item));
  }

  async update(
    entity: EntityName,
    id: string,
    changes: { set?: Record<string, unknown>; add?: Record<string, number>; remove?: readonly string[] },
    condition?: Condition,
  ): Promise<void> {
    if (condition && !this.evaluateCondition(entity, id, condition)) {
      throw new ConditionalCheckError(undefined, [0]);
    }
    this.applyUpdate(entity, id, changes);
  }

  async delete(entity: EntityName, id: string, condition?: Condition): Promise<void> {
    if (condition && !this.evaluateCondition(entity, id, condition)) {
      throw new ConditionalCheckError(undefined, [0]);
    }
    this.tableFor(entity).delete(id);
  }

  async transactWrite(ops: readonly WriteOp[]): Promise<void> {
    if (ops.length === 0) return;
    if (ops.length > MAX_TRANSACT_ITEMS) {
      throw new Error(`TransactWriteItems melebihi batas ${MAX_TRANSACT_ITEMS} operasi: ${ops.length}`);
    }

    // DynamoDB melarang dua operasi pada item yang sama dalam satu transaksi.
    const seen = new Set<string>();
    for (const op of ops) {
      const id = op.op === 'put' ? op.item.id : op.id;
      const key = `${op.entity}#${id}`;
      if (seen.has(key)) {
        throw new Error(`TransactWriteItems memuat dua operasi pada item yang sama: ${key}`);
      }
      seen.add(key);
    }

    // Evaluasi seluruh prasyarat lebih dulu (semua-atau-tidak-sama-sekali).
    const failedIndexes: number[] = [];
    ops.forEach((op, index) => {
      const condition = op.condition;
      if (condition) {
        const id = op.op === 'put' ? op.item.id : op.id;
        if (!this.evaluateCondition(op.entity, id, condition)) {
          failedIndexes.push(index);
        }
      }
    });
    if (failedIndexes.length > 0) {
      throw new ConditionalCheckError(undefined, failedIndexes);
    }

    // Terapkan seluruh operasi.
    for (const op of ops) {
      switch (op.op) {
        case 'put':
          this.tableFor(op.entity).set(op.item.id, stampForPut(op.entity, op.item));
          break;
        case 'update':
          this.applyUpdate(op.entity, op.id, { set: op.set, add: op.add, remove: op.remove });
          break;
        case 'delete':
          this.tableFor(op.entity).delete(op.id);
          break;
        case 'check':
          // Sudah dievaluasi di atas; tidak mengubah apa pun.
          break;
        default: {
          const _exhaustive: never = op;
          throw new Error(`Operasi tulis tidak dikenal: ${JSON.stringify(_exhaustive)}`);
        }
      }
    }
  }
}

/** Membuat repositori DynamoDB produksi dengan nama tabel dari lingkungan. */
export function createLedgerRepo(): LedgerRepo {
  return new DynamoLedgerRepo();
}
