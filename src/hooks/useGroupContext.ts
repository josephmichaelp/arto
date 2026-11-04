/**
 * Konteks grup keuangan bersama.
 *
 * Menyimpan apakah saat ini Pengguna berada dalam mode "Pribadi" (data
 * miliknya sendiri) atau mode "Grup" (data bersama). Preferensi disimpan
 * di localStorage sehingga tidak perlu dipilih ulang setiap buka aplikasi.
 *
 * Hook `useMyGroupContext` mengambil info semua grup dari backend dan
 * menginisialisasi konteks saat pertama kali dimuat.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { loadAmplifyOutputs } from '../app/amplify';
import { getDataClient } from '../app/dataClient';
import { fromAwsJson, toAwsJson } from '../app/awsJson';

// ---------------------------------------------------------------------------
// Tipe
// ---------------------------------------------------------------------------

export type GroupRole = 'OWNER' | 'CO_OWNER' | 'VIEWER';

export interface GroupInfo {
  groupId: string;
  groupName: string;
  role: GroupRole;
  isOwner: boolean;
}

export interface GroupContextState {
  /** 'personal' = data pribadi; 'group' = data grup aktif */
  mode: 'personal' | 'group';
  groupId: string | null;
  groupName: string | null;
  myRole: GroupRole | null;
  canWrite: boolean;
}

const STORAGE_KEY = 'arto:group-context:v1';

function readStorage(): GroupContextState | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as GroupContextState) : null;
  } catch {
    return null;
  }
}

function writeStorage(ctx: GroupContextState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ctx));
  } catch {
    /* abaikan jika localStorage diblokir */
  }
}

function personalState(): GroupContextState {
  return { mode: 'personal', groupId: null, groupName: null, myRole: null, canWrite: true };
}

// ---------------------------------------------------------------------------
// Hook utama
// ---------------------------------------------------------------------------

export interface UseGroupContextResult {
  context: GroupContextState;
  /** Semua grup di mana Pengguna adalah anggota aktif. */
  groups: GroupInfo[];
  isLoading: boolean;
  /** Beralih ke konteks pribadi. */
  switchToPersonal: () => void;
  /** Beralih ke konteks grup tertentu. */
  switchToGroup: (info: GroupInfo) => void;
}

export function useGroupContext(): UseGroupContextResult {
  const [context, setContext] = useState<GroupContextState>(() => {
    return readStorage() ?? personalState();
  });

  // Query semua keanggotaan dari backend
  const { data: rawCtx, isLoading } = useQuery({
    queryKey: ['my-group-context'],
    queryFn: async () => {
      if (!loadAmplifyOutputs()) return null;
      const client = getDataClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fn = (client.queries as any).getMyGroupContext as
        | ((args: { input?: unknown }) => Promise<{ data: unknown; errors?: { message: string }[] }>)
        | undefined;
      if (!fn) return null;
      const { data, errors } = await fn({ input: toAwsJson({}) });
      if (errors?.length) return null;
      // Lambda mengembalikan amplop { ok, data: { ownedGroupId, groups } }.
      // Unwrap di sini agar rawCtx langsung berisi { ownedGroupId, groups }.
      const envelope = fromAwsJson<{
        ok: boolean;
        data?: {
          ownedGroupId: string | null;
          groups: Array<{ groupId: string; groupName: string; role: GroupRole; isOwner: boolean }>;
        };
      } | null>(data);
      return envelope?.ok ? (envelope.data ?? null) : null;
    },
    staleTime: 60 * 1000,
  });

  const groups = useMemo((): GroupInfo[] => {
    return (rawCtx?.groups ?? []).map((g) => ({
      groupId: g.groupId,
      groupName: g.groupName,
      role: g.role,
      isOwner: g.isOwner,
    }));
  }, [rawCtx]);

  // Validasi: kalau konteks tersimpan grup sudah tidak ada lagi, reset ke pribadi
  useEffect(() => {
    if (context.mode === 'group' && groups.length > 0) {
      const still = groups.find((g) => g.groupId === context.groupId);
      if (!still) {
        const newCtx = personalState();
        setContext(newCtx);
        writeStorage(newCtx);
      }
    }
  }, [context, groups]);

  const switchToPersonal = useCallback(() => {
    const s = personalState();
    setContext(s);
    writeStorage(s);
  }, []);

  const switchToGroup = useCallback((info: GroupInfo) => {
    const s: GroupContextState = {
      mode: 'group',
      groupId: info.groupId,
      groupName: info.groupName,
      myRole: info.role,
      canWrite: info.role !== 'VIEWER',
    };
    setContext(s);
    writeStorage(s);
  }, []);

  return { context, groups, isLoading, switchToPersonal, switchToGroup };
}

// ---------------------------------------------------------------------------
// Hook untuk mutasi grup
// ---------------------------------------------------------------------------

type GroupEnvelope<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

async function callGroupManager<T>(
  mutationName: string,
  payload: Record<string, unknown>,
): Promise<T> {
  if (!loadAmplifyOutputs()) {
    throw new Error('Amplify belum dikonfigurasi');
  }
  const client = getDataClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fn = (client.mutations as any)[mutationName] as
    | ((args: { input: unknown }) => Promise<{ data: unknown; errors?: { message: string }[] }>)
    | undefined;
  if (!fn) throw new Error(`Mutasi ${mutationName} tidak ditemukan`);
  const { data, errors } = await fn({ input: toAwsJson(payload) });
  if (errors?.length) throw new Error(errors[0]?.message ?? `Gagal: ${mutationName}`);
  const envelope = fromAwsJson<GroupEnvelope<T>>(data);
  if (!envelope?.ok) {
    throw new Error((envelope as { ok: false; error: { message: string } }).error?.message ?? 'Gagal');
  }
  return (envelope as { ok: true; data: T }).data;
}

export function useCreateGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string }) => callGroupManager('createGroup', input),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['my-group-context'] }); },
  });
}

export function useInviteMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; role: 'CO_OWNER' | 'VIEWER'; groupId: string }) =>
      callGroupManager('inviteMember', input),
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: ['group-members', v.groupId] });
    },
  });
}

export function useResendInvitation() {
  return useMutation({
    mutationFn: (input: { memberId: string }) => callGroupManager('resendInvitation', input),
  });
}

export function useAcceptInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { token: string }) => callGroupManager<{ groupId: string; groupName: string; role: GroupRole }>('acceptInvitation', input),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['my-group-context'] }); },
  });
}

export function useDeclineInvitation() {
  return useMutation({
    mutationFn: (input: { token: string }) => callGroupManager('declineInvitation', input),
  });
}

export function useUpdateMemberRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { memberId: string; role: 'CO_OWNER' | 'VIEWER'; groupId: string }) =>
      callGroupManager('updateMemberRole', input),
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: ['group-members', v.groupId] });
    },
  });
}

export function useRemoveMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { memberId: string; groupId: string }) =>
      callGroupManager('removeMember', input),
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: ['group-members', v.groupId] });
    },
  });
}

export function useLeaveGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { groupId: string }) => callGroupManager('leaveGroup', input),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['my-group-context'] }); },
  });
}

export function useDisbandGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { groupId: string }) => callGroupManager('disbandGroup', input),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['my-group-context'] }); },
  });
}

export interface GroupMemberDetail {
  id: string;
  email: string;
  role: 'OWNER' | 'CO_OWNER' | 'VIEWER';
  status: 'PENDING' | 'ACTIVE' | 'REMOVED' | 'DECLINED';
  invitedAt: string;
  acceptedAt?: string;
  tokenExpiresAt?: string;
}

export function useGroupMembers(groupId: string | null) {
  return useQuery({
    queryKey: ['group-members', groupId],
    enabled: Boolean(groupId),
    queryFn: async (): Promise<GroupMemberDetail[]> => {
      if (!groupId || !loadAmplifyOutputs()) return [];
      const client = getDataClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fn = (client.queries as any).listGroupMembersDetail as
        | ((args: { input: unknown }) => Promise<{ data: unknown; errors?: { message: string }[] }>)
        | undefined;
      if (!fn) return [];
      const { data, errors } = await fn({ input: toAwsJson({ groupId }) });
      if (errors?.length) throw new Error(errors[0]?.message ?? 'Gagal memuat anggota');
      // Unwrap amplop { ok, data: { members } }
      const envelope = fromAwsJson<{ ok: boolean; data?: { members: GroupMemberDetail[] } } | null>(data);
      return (envelope?.ok ? envelope.data?.members : null) ?? [];
    },
    staleTime: 30 * 1000,
  });
}
