/**
 * Operasi Keuangan Bersama untuk Lambda `ledger`.
 *
 * Modul ini menambahkan dua kemampuan ke Lambda `ledger`:
 *
 * 1. `checkGroupAccess` — dipakai setiap operasi tulis yang membawa `groupId`.
 *    Memvalidasi bahwa pemanggil adalah anggota aktif dengan peran yang cukup.
 *
 * 2. `listGroupData` — query data grup (dompet, kategori, transaksi, dll.)
 *    berdasarkan `groupId`. Dipanggil lewat custom query AppSync
 *    `listGroupWallets`, `listGroupTransactions`, dst.
 *
 * Semua operasi tulis data grup tetap melalui operasi-operasi yang sudah ada
 * di modul lain (operations-wallet-category, operations-transaction, dll.)
 * — perbedaannya hanya rekaman ditulis dengan `groupId` yang disertakan.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

// ---------------------------------------------------------------------------
// Tipe
// ---------------------------------------------------------------------------

export type GroupRole = 'OWNER' | 'CO_OWNER' | 'VIEWER';

/** Info akses grup yang dikembalikan `checkGroupAccess`. */
export interface GroupAccess {
  groupId: string;
  role: GroupRole;
  /** sub::username pemanggil (untuk dipakai sebagai owner rekaman baru). */
  callerOwner: string;
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export type GroupAccessErrorCode = 'GROUP_ACCESS_DENIED' | 'GROUP_NOT_MEMBER';

export class GroupAccessError extends Error {
  readonly code: GroupAccessErrorCode;

  constructor(code: GroupAccessErrorCode, message: string) {
    super(message);
    this.name = 'GroupAccessError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// DynamoDB helper
// ---------------------------------------------------------------------------

let sharedDocClient: DynamoDBDocumentClient | undefined;

export function getGroupDocClient(): DynamoDBDocumentClient {
  if (!sharedDocClient) {
    sharedDocClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    });
  }
  return sharedDocClient;
}

/** Mengosongkan klien bersama. Dipakai pengujian. */
export function resetGroupDocClient(): void {
  sharedDocClient = undefined;
}

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Variabel lingkungan ${key} belum diset`);
  return v;
}

// ---------------------------------------------------------------------------
// checkGroupAccess
// ---------------------------------------------------------------------------

/**
 * Memvalidasi bahwa `callerSub` adalah anggota aktif grup `groupId`
 * dengan peran yang cukup untuk operasi yang diminta.
 *
 * @param callerSub   - sub Cognito pemanggil (dari event.identity.sub)
 * @param callerOwner - owner field pemanggil (sub::username)
 * @param groupId     - ID grup yang diklaim
 * @param minRole     - peran minimum yang dibutuhkan ('CO_OWNER' = tulis,
 *                      'VIEWER' = baca, 'OWNER' = aksi pemilik)
 * @throws {GroupAccessError} bila bukan anggota atau peran tidak cukup
 */
export async function checkGroupAccess(
  callerSub: string,
  callerOwner: string,
  groupId: string,
  minRole: 'CO_OWNER' | 'VIEWER',
): Promise<GroupAccess> {
  const memberTable = requireEnv('GROUP_MEMBER_TABLE_NAME');

  const result = await getGroupDocClient().send(
    new QueryCommand({
      TableName: memberTable,
      IndexName: 'inviteeSub-index',
      KeyConditionExpression: 'inviteeSub = :sub',
      FilterExpression: 'groupId = :g AND #st = :a',
      ExpressionAttributeNames: { '#st': 'status' },
      ExpressionAttributeValues: {
        ':sub': callerSub,
        ':g': groupId,
        ':a': 'ACTIVE',
      },
    }),
  );

  const member = result.Items?.[0] as
    | { role: GroupRole; status: string }
    | undefined;

  if (!member) {
    throw new GroupAccessError(
      'GROUP_NOT_MEMBER',
      'Anda bukan anggota aktif grup ini',
    );
  }

  // Hierarki peran: OWNER > CO_OWNER > VIEWER
  if (minRole === 'CO_OWNER' && member.role === 'VIEWER') {
    throw new GroupAccessError(
      'GROUP_ACCESS_DENIED',
      'Anda tidak memiliki izin untuk mengubah data grup ini',
    );
  }

  return { groupId, role: member.role, callerOwner };
}

// ---------------------------------------------------------------------------
// listGroupData
// ---------------------------------------------------------------------------

/**
 * Membaca semua rekaman suatu entitas yang milik sebuah grup.
 *
 * Memakai DynamoDB Scan dengan `FilterExpression groupId = :g` karena
 * jumlah rekaman per grup (personal finance, max 5 anggota) masih jauh
 * di bawah ambang di mana GSI diperlukan untuk performa.
 */
export async function listGroupData(
  tableName: string,
  groupId: string,
): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const out = await getGroupDocClient().send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: 'groupId = :g',
        ExpressionAttributeValues: { ':g': groupId },
        ExclusiveStartKey: lastKey,
      }),
    );
    for (const item of out.Items ?? []) {
      items.push(item as Record<string, unknown>);
    }
    lastKey = out.LastEvaluatedKey;
  } while (lastKey);

  return items;
}
