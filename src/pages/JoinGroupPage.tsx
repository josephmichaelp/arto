/**
 * JoinGroupPage — halaman penerimaan undangan grup (rute `/bergabung`).
 *
 * Dibuka dari tautan undangan email yang berformat:
 *   /bergabung?token=<jwt_token>
 *
 * Alur:
 * 1. Baca token dari URL query string.
 * 2. Jika belum login → simpan token ke sessionStorage → arahkan ke login.
 * 3. Setelah login → baca token kembali → tampilkan konfirmasi.
 * 4. Pengguna terima atau tolak undangan.
 * 5. Setelah terima → alihkan ke halaman grup dan aktifkan konteks grup baru.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthenticator } from '@aws-amplify/ui-react';
import { useAcceptInvitation, useDeclineInvitation, useGroupContext } from '../hooks/useGroupContext';
import type { GroupRole } from '../hooks/useGroupContext';

const SESSION_KEY = 'arto:pending-invite-token';

const ROLE_LABEL: Record<GroupRole, string> = {
  OWNER: 'Owner',
  CO_OWNER: 'Co-Owner (can record and edit data)',
  VIEWER: 'Viewer (read-only)',
};

/**
 * Mengambil token dari URL query string atau sessionStorage.
 * Sesudah diambil dari sessionStorage, hapus agar tidak dipakai ulang.
 */
function consumeToken(): string | null {
  const params = new URLSearchParams(window.location.search);
  const urlToken = params.get('token');
  if (urlToken) {
    return urlToken;
  }
  try {
    const stored = window.sessionStorage.getItem(SESSION_KEY);
    if (stored) window.sessionStorage.removeItem(SESSION_KEY);
    return stored;
  } catch {
    return null;
  }
}

function saveTokenForAfterLogin(token: string): void {
  try {
    window.sessionStorage.setItem(SESSION_KEY, token);
  } catch {
    /* abaikan */
  }
}

/**
 * Membaca info dasar dari payload JWT tanpa verifikasi (hanya untuk tampilan).
 * Verifikasi sesungguhnya dilakukan di Lambda backend.
 */
function peekToken(token: string): {
  email?: string;
  role?: GroupRole;
  exp?: number;
} | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const raw = atob(parts[1]!.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(raw) as { email?: string; role?: GroupRole; exp?: number };
  } catch {
    return null;
  }
}

export function JoinGroupPage() {
  const navigate = useNavigate();
  const { user } = useAuthenticator((ctx) => [ctx.user]);
  const accept = useAcceptInvitation();
  const decline = useDeclineInvitation();
  const { switchToGroup } = useGroupContext();

  const [token, setToken] = useState<string | null>(null);
  const [peek, setPeek] = useState<ReturnType<typeof peekToken>>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const t = consumeToken();
    if (!t) {
      // Tidak ada token → kembali ke beranda
      navigate('/', { replace: true });
      return;
    }

    if (!user) {
      // Belum login → simpan token dan arahkan ke login (root route)
      saveTokenForAfterLogin(t);
      navigate('/', { replace: true });
      return;
    }

    setToken(t);
    setPeek(peekToken(t));
  }, [user, navigate]);

  if (!token || !user) {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <p style={{ color: 'var(--color-ink-muted, #6b7280)' }}>Memuat undangan…</p>
      </div>
    );
  }

  if (done) {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: 24, marginBottom: 8 }}>✓</p>
          <p style={{ fontWeight: 700, fontSize: 18, marginBottom: 4 }}>Bergabung berhasil</p>
          <p style={{ fontSize: 14, color: 'var(--color-ink-muted, #6b7280)', marginBottom: 20 }}>
            Mengalihkan ke halaman grup…
          </p>
        </div>
      </div>
    );
  }

  const isExpired = peek?.exp ? Date.now() / 1000 > peek.exp : false;

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, color: 'var(--color-ink, #1f2430)' }}>
      <div style={{
        width: '100%',
        maxWidth: 400,
        background: 'rgba(255,255,255,0.72)',
        borderRadius: 24,
        border: '1px solid rgba(255,255,255,0.5)',
        boxShadow: '0 18px 48px rgba(31,36,48,0.12)',
        padding: '32px 24px',
      }}>
        <p style={{ fontSize: 28, textAlign: 'center', marginBottom: 4 }}>✉️</p>
        <h1 style={{ fontWeight: 700, fontSize: 20, textAlign: 'center', margin: '0 0 20px' }}>
          Undangan Grup Keuangan
        </h1>

        {isExpired ? (
          <div>
            <p style={{ color: 'var(--color-semantic-expense, #b3261e)', textAlign: 'center', marginBottom: 16 }}>
              Tautan undangan ini sudah kedaluwarsa.<br />
              Minta pemilik grup untuk mengirim ulang undangan.
            </p>
            <button
              type="button"
              onClick={() => navigate('/', { replace: true })}
              style={{
                width: '100%', minHeight: 46, borderRadius: 12, border: 'none',
                background: 'var(--color-brand-blue, #005DAC)', color: '#fff',
                fontWeight: 700, fontSize: 16, cursor: 'pointer',
              }}
            >
              Kembali ke Beranda
            </button>
          </div>
        ) : (
          <div>
            <div style={{ background: 'rgba(0,93,172,0.06)', borderRadius: 12, padding: '12px 14px', marginBottom: 20 }}>
              <p style={{ margin: '0 0 4px', fontSize: 13, color: 'var(--color-ink-muted, #6b7280)' }}>Diundang sebagai</p>
              <p style={{ margin: 0, fontWeight: 700, fontSize: 16 }}>
                {peek?.role ? ROLE_LABEL[peek.role] : '–'}
              </p>
            </div>

            {accept.isError && (
              <p role="alert" style={{ color: 'var(--color-semantic-expense, #b3261e)', fontSize: 14, marginBottom: 12 }}>
                {accept.error?.message ?? 'Gagal menerima undangan'}
              </p>
            )}
            {decline.isSuccess && (
              <p style={{ color: 'var(--color-ink-muted, #6b7280)', fontSize: 14, marginBottom: 12, textAlign: 'center' }}>
                Undangan ditolak.
              </p>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                onClick={() => {
                  decline.mutate(
                    { token },
                    { onSuccess: () => setTimeout(() => navigate('/', { replace: true }), 2000) },
                  );
                }}
                disabled={decline.isPending || decline.isSuccess}
                style={{
                  flex: 1, minHeight: 46, borderRadius: 12,
                  border: '1.5px solid rgba(0,0,0,0.12)', background: 'transparent',
                  color: 'var(--color-ink-muted, #6b7280)', fontWeight: 600, fontSize: 15,
                  cursor: decline.isPending ? 'wait' : 'pointer',
                  opacity: decline.isPending ? 0.5 : 1,
                }}
              >
                Tolak
              </button>
              <button
                type="button"
                onClick={() => {
                  accept.mutate(
                    { token },
                    {
                      onSuccess: (data) => {
                        setDone(true);
                        const d = data as { groupId?: string; groupName?: string; role?: GroupRole };
                        if (d?.groupId && d?.groupName && d?.role) {
                          switchToGroup({ groupId: d.groupId, groupName: d.groupName, role: d.role, isOwner: false });
                        }
                        setTimeout(() => navigate('/grup', { replace: true }), 1500);
                      },
                    },
                  );
                }}
                disabled={accept.isPending}
                style={{
                  flex: 2, minHeight: 46, borderRadius: 12, border: 'none',
                  background: 'var(--color-brand-blue, #005DAC)', color: '#fff',
                  fontWeight: 700, fontSize: 15,
                  cursor: accept.isPending ? 'wait' : 'pointer',
                  opacity: accept.isPending ? 0.5 : 1,
                }}
              >
                {accept.isPending ? 'Bergabung…' : 'Terima & Bergabung'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default JoinGroupPage;
