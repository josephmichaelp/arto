/**
 * AuthenticatedLayout (Tugas 12.1, 12.14).
 *
 * Shell halaman setelah pengguna masuk:
 * - GlassBar atas: nama aplikasi + tombol keluar.
 * - `<main>`: area konten halaman aktif (`<Outlet />`).
 * - GlassBar bawah: navigasi 5 tab utama (Req 17.8, 17.12, 15.7).
 *
 * Navigasi antar tab memakai `navigateWithTransition` agar
 * View Transitions API dipakai bila tersedia (Req 17.5, 15.6).
 *
 * Requirements: 1.3, 1.4, 1.7, 15.1, 15.2, 15.4, 15.5, 15.7,
 *               17.1, 17.5, 17.8, 17.11, 17.12, 18.7, 18.8
 */

import { useAuthenticator } from '@aws-amplify/ui-react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { GlassBar } from './components/GlassBar';
import { useBootstrapUser } from './hooks/useBootstrapUser';
import { navigateWithTransition } from './motion/navigateWithTransition';
import { useReducedMotion } from './motion/useReducedMotion';

// ---------------------------------------------------------------------------
// Definisi 5 tab navigasi bawah (Req 15.7)
// ---------------------------------------------------------------------------

interface NavTab {
  /** Jalur rute. */
  path: string;
  /** Label teks Indonesia. */
  label: string;
  /** Ikon emoji (aria-hidden di sisi render). */
  icon: string;
  /** aria-label yang deskriptif untuk pembaca layar. */
  ariaLabel: string;
}

const NAV_TABS: NavTab[] = [
  { path: '/',           label: 'Beranda',   icon: '🏠', ariaLabel: 'Beranda'     },
  { path: '/transaksi',  label: 'Transaksi', icon: '💸', ariaLabel: 'Transaksi'   },
  { path: '/laporan',    label: 'Laporan',   icon: '📈', ariaLabel: 'Laporan'     },
  { path: '/notifikasi', label: 'Notifikasi',icon: '🔔', ariaLabel: 'Notifikasi'  },
  { path: '/pengaturan', label: 'Pengaturan',icon: '⚙️', ariaLabel: 'Pengaturan'  },
];

// ---------------------------------------------------------------------------
// Sub-komponen: satu tombol tab navigasi bawah
// ---------------------------------------------------------------------------

interface NavTabButtonProps {
  tab: NavTab;
  active: boolean;
  onClick: () => void;
}

function NavTabButton({ tab, active, onClick }: NavTabButtonProps) {
  return (
    <button
      type="button"
      aria-label={tab.ariaLabel}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      style={{
        flex: '1 1 0',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        minHeight: 'var(--hit, 44px)',
        minWidth: 'var(--hit, 44px)',
        padding: '4px 2px',
        border: 'none',
        background: 'none',
        cursor: 'pointer',
        color: active
          ? 'var(--color-brand-blue, #005DAC)'
          : 'var(--color-ink-muted, #6b7280)',
        transition: 'color 150ms var(--ease-standard, cubic-bezier(0.2,0,0,1))',
      }}
    >
      {/* Ikon */}
      <span
        aria-hidden="true"
        style={{
          fontSize: 22,
          lineHeight: 1,
          display: 'block',
          /* Latar sorot pada tab aktif (tidak bergantung pada warna saja). */
          background: active ? 'var(--color-brand-blue-alpha, rgba(0,93,172,0.12))' : 'transparent',
          borderRadius: 8,
          padding: '2px 12px',
          transition: 'background 150ms var(--ease-standard, cubic-bezier(0.2,0,0,1))',
        }}
      >
        {tab.icon}
      </span>
      {/* Label teks (Req 15.5: tidak hanya ikon) */}
      <span
        style={{
          fontSize: 10,
          fontWeight: active ? 700 : 500,
          lineHeight: 1.2,
          letterSpacing: '0.01em',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: '100%',
        }}
      >
        {tab.label}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Layout utama
// ---------------------------------------------------------------------------

export function AuthenticatedLayout() {
  const { user, signOut } = useAuthenticator((ctx) => [ctx.user]);
  const navigate = useNavigate();
  const location = useLocation();
  const reduced = useReducedMotion();

  /**
   * Penyiapan data awal akun (Req 3.1, 1.2). Dulu dikerjakan trigger Cognito
   * `post-confirmation`; kini mutation idempoten `bootstrapUser` yang dipanggil
   * sekali di sini. `user.userId` adalah `sub` Cognito.
   */
  const { ready: accountReady, error: bootstrapError } = useBootstrapUser(user?.userId);

  /** Deteksi tab aktif: Beranda aktif hanya saat path persis '/'. */
  function isActive(path: string): boolean {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  }

  /** Navigasi dengan transisi halaman (View Transitions API bila tersedia). */
  function handleTabClick(path: string) {
    if (location.pathname === path) return; // sudah di halaman ini
    navigateWithTransition(() => navigate(path), reduced);
  }

  return (
    <div
      style={{
        height: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Latar gradien mesh (Req 18.7) */}
      <div id="app-bg" aria-hidden="true" />

      {/* ------------------------------------------------------------------ */}
      {/* Bilah navigasi atas (Req 17.8)                                      */}
      {/* ------------------------------------------------------------------ */}
      <GlassBar position="top" aria-label="Navigasi Arto">
        <span style={{ fontWeight: 600, fontSize: 'var(--font-size-title)' }}>
          Arto
        </span>
        <button
          type="button"
          onClick={signOut}
          style={{
            marginLeft: 'auto',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: 'var(--font-size-caption)',
            color: 'var(--color-ink)',
            minHeight: 'var(--hit, 44px)',
            padding: '0 4px',
          }}
          aria-label={`Keluar dari akun ${user?.signInDetails?.loginId ?? ''}`}
        >
          Keluar
        </button>
      </GlassBar>

      {/* ------------------------------------------------------------------ */}
      {/* Konten halaman                                                       */}
      {/* ------------------------------------------------------------------ */}
      <main
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: '0 16px',
          /* Ruang ekstra di bawah agar konten tidak tertutup FAB + bottom nav. */
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {bootstrapError ? (
          <p
            role="alert"
            style={{
              margin: '12px 0 0',
              fontSize: 'var(--font-size-caption)',
              color: 'var(--color-ink-muted, #6b7280)',
            }}
          >
            Sebagian data awal akun belum siap. Muat ulang halaman bila daftar
            kategori atau dompet terlihat kosong.
          </p>
        ) : null}

        {accountReady ? (
          <Outlet />
        ) : (
          <p
            role="status"
            aria-live="polite"
            style={{
              margin: '32px 0',
              textAlign: 'center',
              fontSize: 'var(--font-size-body)',
              color: 'var(--color-ink-muted, #6b7280)',
            }}
          >
            Menyiapkan akun Anda…
          </p>
        )}
      </main>

      {/* ------------------------------------------------------------------ */}
      {/* Bilah navigasi bawah — 5 tab utama (Req 17.8, 17.12, 15.7)          */}
      {/* ------------------------------------------------------------------ */}
      <GlassBar
        position="bottom"
        as="nav"
        aria-label="Navigasi utama"
        style={{
          display: 'flex',
          alignItems: 'stretch',
          justifyContent: 'space-around',
          padding: '0',
          paddingBottom: 'max(4px, env(safe-area-inset-bottom))',
          gap: 0,
        }}
      >
        {NAV_TABS.map((tab) => (
          <NavTabButton
            key={tab.path}
            tab={tab}
            active={isActive(tab.path)}
            onClick={() => handleTabClick(tab.path)}
          />
        ))}
      </GlassBar>
    </div>
  );
}

export default AuthenticatedLayout;
