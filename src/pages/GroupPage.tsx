/**
 * GroupPage — halaman manajemen grup keuangan bersama (rute `/grup`).
 *
 * Menampilkan tiga keadaan:
 * 1. Belum punya grup → tampilkan CTA buat grup.
 * 2. Pemilik grup aktif → tampilkan daftar anggota + tombol undang.
 * 3. Anggota non-pemilik → tampilkan daftar anggota + tombol keluar.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { LargeTitle } from '../components/LargeTitle';
import { SoftCard } from '../components/SoftCard';
import { Skeleton } from '../components/Skeleton';
import {
  useGroupContext,
  useCreateGroup,
  useInviteMember,
  useUpdateMemberRole,
  useRemoveMember,
  useLeaveGroup,
  useDisbandGroup,
  useResendInvitation,
  useGroupMembers,
  type GroupMemberDetail,
} from '../hooks/useGroupContext';

const INPUT_STYLE: React.CSSProperties = {
  width: '100%',
  minHeight: 44,
  padding: '0 12px',
  borderRadius: 12,
  border: '1.5px solid var(--color-separator, rgba(0,0,0,0.12))',
  background: 'var(--color-card, #fff)',
  color: 'var(--color-ink, #1f2430)',
  fontSize: 'var(--font-size-body, 16px)',
  boxSizing: 'border-box',
};

const BTN_PRIMARY: React.CSSProperties = {
  minHeight: 44,
  padding: '0 20px',
  borderRadius: 12,
  border: 'none',
  background: 'var(--color-brand-blue, #005DAC)',
  color: '#fff',
  fontWeight: 700,
  fontSize: 'var(--font-size-body, 16px)',
  cursor: 'pointer',
};

const BTN_GHOST: React.CSSProperties = {
  minHeight: 44,
  padding: '0 16px',
  borderRadius: 12,
  border: '1.5px solid var(--color-separator, rgba(0,0,0,0.12))',
  background: 'transparent',
  color: 'var(--color-ink-muted, #6b7280)',
  fontSize: 'var(--font-size-body, 16px)',
  cursor: 'pointer',
};

const BTN_DANGER: React.CSSProperties = {
  ...BTN_GHOST,
  color: 'var(--color-semantic-expense, #b3261e)',
  borderColor: 'var(--color-semantic-expense, #b3261e)',
};

// ---------------------------------------------------------------------------
// Komponen seksi
// ---------------------------------------------------------------------------

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <p style={{
      margin: '0 0 8px 4px',
      fontSize: 11,
      color: 'var(--color-ink-muted, #6b7280)',
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
    }}>
      {children}
    </p>
  );
}

function ErrorMsg({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return (
    <p role="alert" style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--color-semantic-expense, #b3261e)' }}>
      {msg}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Belum punya grup
// ---------------------------------------------------------------------------

function CreateGroupSection() {
  const [name, setName] = useState('');
  const createGroup = useCreateGroup();

  const handleCreate = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    createGroup.mutate({ name: trimmed });
  };

  return (
    <SoftCard style={{ padding: '20px 16px' }}>
      <p style={{ margin: '0 0 6px', fontWeight: 700, fontSize: 'var(--font-size-body, 16px)' }}>
        Buat Grup Keuangan Bersama
      </p>
      <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--color-ink-muted, #6b7280)' }}>
        Undang anggota keluarga untuk melihat dan mencatat keuangan bersama. Maks. 5 orang termasuk kamu.
      </p>
      <label htmlFor="group-name" style={{ display: 'block', marginBottom: 6, fontSize: 13, fontWeight: 600, color: 'var(--color-ink-muted, #6b7280)' }}>
        Nama Grup
      </label>
      <input
        id="group-name"
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Mis. Keluarga Budi"
        maxLength={60}
        style={{ ...INPUT_STYLE, marginBottom: 12 }}
        onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
      />
      <button
        type="button"
        onClick={handleCreate}
        disabled={!name.trim() || createGroup.isPending}
        style={{
          ...BTN_PRIMARY,
          opacity: !name.trim() || createGroup.isPending ? 0.5 : 1,
          cursor: !name.trim() || createGroup.isPending ? 'not-allowed' : 'pointer',
        }}
      >
        {createGroup.isPending ? 'Membuat…' : 'Buat Grup'}
      </button>
      <ErrorMsg msg={createGroup.error?.message ?? null} />
    </SoftCard>
  );
}

// ---------------------------------------------------------------------------
// Badge status
// ---------------------------------------------------------------------------

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Aktif',
  PENDING: 'Menunggu',
  REMOVED: 'Dihapus',
  DECLINED: 'Ditolak',
};

const ROLE_LABEL: Record<string, string> = {
  OWNER: 'Pemilik',
  CO_OWNER: 'Ko-Pemilik',
  VIEWER: 'Penonton',
};

// ---------------------------------------------------------------------------
// Baris anggota
// ---------------------------------------------------------------------------

function MemberRow({
  member,
  isOwnerView,
  groupId,
}: {
  member: GroupMemberDetail;
  isOwnerView: boolean;
  groupId: string;
}) {
  const updateRole = useUpdateMemberRole();
  const remove = useRemoveMember();
  const resend = useResendInvitation();
  const [err, setErr] = useState<string | null>(null);

  const isSelf = member.role === 'OWNER';
  const isPending = member.status === 'PENDING';
  const isExpired = isPending && member.tokenExpiresAt
    ? new Date(member.tokenExpiresAt) < new Date()
    : false;

  return (
    <div style={{ padding: '12px 0', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontWeight: 600, fontSize: 'var(--font-size-body, 16px)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {member.email}
          </p>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--color-ink-muted, #6b7280)' }}>
            {ROLE_LABEL[member.role] ?? member.role}
            {' · '}
            <span style={{ color: isPending ? 'var(--color-semantic-expense, #b3261e)' : undefined }}>
              {STATUS_LABEL[member.status] ?? member.status}
              {isExpired ? ' (kedaluwarsa)' : ''}
            </span>
          </p>
        </div>

        {isOwnerView && !isSelf && member.status === 'ACTIVE' && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              title={member.role === 'CO_OWNER' ? 'Jadikan Penonton' : 'Jadikan Ko-Pemilik'}
              onClick={() => {
                setErr(null);
                updateRole.mutate(
                  { memberId: member.id, role: member.role === 'CO_OWNER' ? 'VIEWER' : 'CO_OWNER', groupId },
                  { onError: (e) => setErr(e.message) },
                );
              }}
              style={{ ...BTN_GHOST, padding: '0 12px', fontSize: 13 }}
            >
              {member.role === 'CO_OWNER' ? '→ Penonton' : '→ Ko-Pemilik'}
            </button>
            <button
              type="button"
              onClick={() => {
                if (!confirm(`Hapus ${member.email} dari grup?`)) return;
                setErr(null);
                remove.mutate(
                  { memberId: member.id, groupId },
                  { onError: (e) => setErr(e.message) },
                );
              }}
              style={{ ...BTN_DANGER, padding: '0 12px', fontSize: 13 }}
            >
              Hapus
            </button>
          </div>
        )}

        {isOwnerView && isPending && (
          <button
            type="button"
            onClick={() => {
              setErr(null);
              resend.mutate(
                { memberId: member.id },
                { onError: (e) => setErr(e.message) },
              );
            }}
            style={{ ...BTN_GHOST, padding: '0 12px', fontSize: 13 }}
          >
            Kirim Ulang
          </button>
        )}
      </div>
      <ErrorMsg msg={err} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Form undang anggota
// ---------------------------------------------------------------------------

function InviteForm({ groupId, memberCount }: { groupId: string; memberCount: number }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'CO_OWNER' | 'VIEWER'>('CO_OWNER');
  const invite = useInviteMember();

  const canInvite = memberCount < 5;

  const handleInvite = () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;
    invite.mutate(
      { email: trimmed, role, groupId },
      { onSuccess: () => { setEmail(''); invite.reset(); } },
    );
  };

  if (!canInvite) {
    return (
      <p style={{ margin: 0, fontSize: 13, color: 'var(--color-ink-muted, #6b7280)' }}>
        Grup sudah penuh (5/5 anggota).
      </p>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="email@contoh.com"
          style={{ ...INPUT_STYLE, flex: '1 1 200px' }}
          onKeyDown={(e) => { if (e.key === 'Enter') handleInvite(); }}
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as 'CO_OWNER' | 'VIEWER')}
          style={{ ...INPUT_STYLE, flex: '0 1 160px' }}
        >
          <option value="CO_OWNER">Ko-Pemilik</option>
          <option value="VIEWER">Penonton</option>
        </select>
        <button
          type="button"
          onClick={handleInvite}
          disabled={!email.trim() || invite.isPending}
          style={{
            ...BTN_PRIMARY,
            opacity: !email.trim() || invite.isPending ? 0.5 : 1,
            cursor: !email.trim() || invite.isPending ? 'not-allowed' : 'pointer',
          }}
        >
          {invite.isPending ? 'Mengundang…' : 'Undang'}
        </button>
      </div>
      {invite.isSuccess && (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--color-semantic-income, #1a7f37)' }}>
          ✓ Undangan terkirim
        </p>
      )}
      <ErrorMsg msg={invite.error?.message ?? null} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Halaman utama
// ---------------------------------------------------------------------------

export function GroupPage() {
  const { context, groups } = useGroupContext();
  const activeGroupId = groups.find((g) => g.isOwner)?.groupId ?? groups[0]?.groupId ?? null;
  const myRole = groups.find((g) => g.groupId === activeGroupId)?.role ?? null;
  const isOwner = myRole === 'OWNER';

  const { data: members, isLoading } = useGroupMembers(activeGroupId);
  const leave = useLeaveGroup();
  const disband = useDisbandGroup();
  const qc = useQueryClient();

  const activeMembers = (members ?? []).filter((m) => m.status === 'ACTIVE');

  // Belum punya grup
  if (groups.length === 0) {
    return (
      <div style={{ paddingBottom: 40 }}>
        <LargeTitle title="Grup Keuangan" />
        <div style={{ padding: '8px 16px 0' }}>
          <CreateGroupSection />
        </div>
      </div>
    );
  }

  const groupInfo = groups.find((g) => g.groupId === activeGroupId);
  void context;

  return (
    <div style={{ paddingBottom: 40 }}>
      <LargeTitle title="Grup Keuangan" />
      <div style={{ padding: '8px 16px 0', display: 'flex', flexDirection: 'column', gap: 24 }}>

        {/* Info Grup */}
        <section>
          <SectionHeading>Info Grup</SectionHeading>
          <SoftCard style={{ padding: '14px 16px' }}>
            <p style={{ margin: '0 0 2px', fontWeight: 700, fontSize: 18 }}>
              {groupInfo?.groupName ?? '–'}
            </p>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--color-ink-muted, #6b7280)' }}>
              {activeMembers.length} dari 5 anggota aktif · Peran kamu: {ROLE_LABEL[myRole ?? ''] ?? '–'}
            </p>
          </SoftCard>
        </section>

        {/* Anggota */}
        <section>
          <SectionHeading>Anggota</SectionHeading>
          <SoftCard style={{ padding: '0 16px' }}>
            {isLoading ? (
              <Skeleton lines={3} height={56} label="Memuat anggota" />
            ) : (
              (members ?? [])
                .filter((m) => m.status !== 'REMOVED')
                .map((m) => (
                  <MemberRow
                    key={m.id}
                    member={m}
                    isOwnerView={isOwner}
                    groupId={activeGroupId!}
                  />
                ))
            )}
          </SoftCard>
        </section>

        {/* Undang anggota (hanya Pemilik) */}
        {isOwner && (
          <section>
            <SectionHeading>Undang Anggota Baru</SectionHeading>
            <SoftCard style={{ padding: '14px 16px' }}>
              <InviteForm groupId={activeGroupId!} memberCount={activeMembers.length} />
            </SoftCard>
          </section>
        )}

        {/* Aksi grup */}
        <section>
          <SectionHeading>Aksi</SectionHeading>
          <SoftCard style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {!isOwner && (
              <button
                type="button"
                onClick={() => {
                  if (!confirm('Keluar dari grup ini?')) return;
                  leave.mutate(
                    { groupId: activeGroupId! },
                    {
                      onSuccess: () => {
                        void qc.invalidateQueries({ queryKey: ['my-group-context'] });
                      },
                    },
                  );
                }}
                style={BTN_DANGER}
              >
                {leave.isPending ? 'Keluar…' : 'Keluar dari Grup'}
              </button>
            )}
            {isOwner && (
              <button
                type="button"
                onClick={() => {
                  if (!confirm('Bubarkan grup ini? Semua anggota akan dikeluarkan.')) return;
                  disband.mutate(
                    { groupId: activeGroupId! },
                    {
                      onSuccess: () => {
                        void qc.invalidateQueries({ queryKey: ['my-group-context'] });
                      },
                    },
                  );
                }}
                style={BTN_DANGER}
              >
                {disband.isPending ? 'Membubarkan…' : 'Bubarkan Grup'}
              </button>
            )}
            <ErrorMsg msg={leave.error?.message ?? disband.error?.message ?? null} />
          </SoftCard>
        </section>
      </div>
    </div>
  );
}

export default GroupPage;
