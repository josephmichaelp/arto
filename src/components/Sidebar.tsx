/**
 * Sidebar / Panel_Samping (Tugas lanjutan UI, Req 15.4, 15.5, 17.11).
 *
 * Drawer kiri yang memuat tujuan sekunder aplikasi. Sebelumnya tujuan ini
 * berupa grid "Menu" 11 tombol di Beranda, yang membuat Beranda panjang dan
 * mencampur navigasi dengan ringkasan keuangan. Navigasi bawah 5 tab tetap
 * ada (Req 15.7, 17.8, 17.12) dan tidak diubah.
 *
 * Aksesibilitas mengikuti pola `BottomSheet`:
 * - `role="dialog"` + `aria-modal="true"` + `aria-label`.
 * - Fokus dipindahkan ke dalam panel saat terbuka dan dikembalikan ke pemicu
 *   saat tertutup.
 * - `Tab` berputar di dalam panel; `Escape` menutup; klik scrim menutup.
 * - Setiap item bertarget sentuh minimal 44 px dan menandai halaman aktif
 *   dengan `aria-current="page"` (tidak hanya lewat warna).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { MOTION_TOKENS, resolveMotion } from '../../shared/domain/motion';
import { navigateWithTransition } from '../motion/navigateWithTransition';
import { useReducedMotion } from '../motion/useReducedMotion';
import { ArtoMark } from './ArtoLogo';

interface SidebarItem {
  path: string;
  label: string;
  icon: string;
}

interface SidebarGroup {
  label: string;
  items: SidebarItem[];
}

/**
 * Tujuan dikelompokkan menurut maksud pemakaian, bukan diurut sembarang,
 * supaya daftar 11 item tetap mudah dipindai.
 */
export const SIDEBAR_GROUPS: readonly SidebarGroup[] = [
  {
    label: 'Catatan',
    items: [
      { path: '/dompet', label: 'Dompet', icon: '💳' },
      { path: '/kategori', label: 'Kategori', icon: '🏷️' },
      { path: '/transaksi', label: 'Transaksi', icon: '📋' },
    ],
  },
  {
    label: 'Rencana',
    items: [
      { path: '/anggaran', label: 'Anggaran', icon: '📊' },
      { path: '/berulang', label: 'Berulang', icon: '🔄' },
      { path: '/target', label: 'Target', icon: '🎯' },
    ],
  },
  {
    label: 'Analisis',
    items: [
      { path: '/laporan', label: 'Laporan', icon: '📈' },
      { path: '/wawasan', label: 'Wawasan', icon: '💡' },
      { path: '/asisten', label: 'Asisten', icon: '🤖' },
    ],
  },
  {
    label: 'Akun',
    items: [
      { path: '/notifikasi', label: 'Notifikasi', icon: '🔔' },
      { path: '/grup', label: 'Grup Keuangan', icon: '👨‍👩‍👧' },
      { path: '/pengaturan', label: 'Pengaturan', icon: '⚙️' },
    ],
  },
];

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const reduced = useReducedMotion();
  const navigate = useNavigate();
  const location = useLocation();

  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<Element | null>(null);

  // `rendered` menahan panel di DOM selama animasi tutup berjalan.
  const [rendered, setRendered] = useState(open);
  const [visible, setVisible] = useState(false);

  const openSpec = resolveMotion(MOTION_TOKENS.sheetOpen, reduced);
  const closeSpec = resolveMotion(MOTION_TOKENS.sheetClose, reduced);

  useEffect(() => {
    if (open) {
      triggerRef.current = document.activeElement;
      setRendered(true);
      return;
    }
    if (!rendered) return;
    setVisible(false);
    const t = window.setTimeout(() => setRendered(false), closeSpec.durationMs);
    return () => window.clearTimeout(t);
  }, [open, rendered, closeSpec.durationMs]);

  // Dinaikkan ke `true` satu frame setelah render agar transisi berjalan.
  useEffect(() => {
    if (!rendered || !open) return;
    const raf = window.requestAnimationFrame(() => setVisible(true));
    return () => window.cancelAnimationFrame(raf);
  }, [rendered, open]);

  // Fokus masuk ke panel saat terbuka; dikembalikan ke pemicu saat tertutup.
  useEffect(() => {
    if (!rendered || !open) return;
    const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    return () => {
      const trigger = triggerRef.current;
      if (trigger instanceof HTMLElement) trigger.focus();
    };
  }, [rendered, open]);

  // Escape menutup; Tab berputar di dalam panel.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const nodes = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!nodes || nodes.length === 0) return;
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const go = useCallback(
    (path: string) => {
      onClose();
      if (location.pathname === path) return;
      navigateWithTransition(() => navigate(path), reduced);
    },
    [location.pathname, navigate, onClose, reduced],
  );

  if (!rendered) return null;

  function isActive(path: string): boolean {
    return location.pathname === path || location.pathname.startsWith(`${path}/`);
  }

  const activeSpec = visible ? openSpec : closeSpec;

  return (
    <div className="arto-sidebar-root">
      <div
        className="arto-sidebar-scrim"
        data-visible={visible ? 'true' : 'false'}
        style={{ transitionDuration: `${activeSpec.durationMs}ms` }}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        className="arto-sidebar"
        data-visible={visible ? 'true' : 'false'}
        data-motion={reduced ? 'reduced' : undefined}
        style={{ transitionDuration: `${activeSpec.durationMs}ms` }}
        role="dialog"
        aria-modal="true"
        aria-label="Menu Arto"
      >
        <div className="arto-sidebar__header">
          <ArtoMark height={22} />
          <span style={{ fontWeight: 600, fontSize: 'var(--font-size-title)' }}>Arto</span>
          <button
            type="button"
            className="arto-sidebar__close"
            onClick={onClose}
            aria-label="Tutup menu"
          >
            ✕
          </button>
        </div>

        <nav aria-label="Menu lengkap">
          {SIDEBAR_GROUPS.map((group) => (
            <div className="arto-sidebar__group" key={group.label}>
              <p className="arto-sidebar__group-label">{group.label}</p>
              {group.items.map((item) => (
                <button
                  key={item.path}
                  type="button"
                  className="arto-sidebar__item"
                  aria-current={isActive(item.path) ? 'page' : undefined}
                  onClick={() => go(item.path)}
                >
                  <span className="arto-sidebar__item-icon" aria-hidden="true">
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
      </div>
    </div>
  );
}

export default Sidebar;