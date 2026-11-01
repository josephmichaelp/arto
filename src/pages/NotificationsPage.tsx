/**
 * NotificationsPage — Halaman Notifikasi (Tugas 12.13).
 *
 * Menampilkan daftar Notifikasi terbaru milik Pengguna. Notifikasi yang
 * belum dibaca ditandai dengan titik biru dan teks "Baru" (bukan hanya
 * warna) sesuai Design System. Mengetuk notifikasi yang belum dibaca akan
 * menandainya sebagai sudah dibaca.
 *
 * Design System: LargeTitle, SoftCard, Skeleton, EmptyState, DateDisplay.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.5, 15.7, 17.3, 17.9, 17.10
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LargeTitle } from '../components/LargeTitle';
import { SoftCard } from '../components/SoftCard';
import { Skeleton } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { DateDisplay } from '../components/DateDisplay';
import { useNotifications, useUnreadCount } from '../hooks';
import type { NotificationItem } from '../hooks';
import { loadAmplifyOutputs } from '../app/amplify';
import { getDataClient } from '../app/dataClient';

// ---------------------------------------------------------------------------
// Mutation: tandai notifikasi dibaca
// ---------------------------------------------------------------------------

function useMarkAsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (notificationId: string) => {
      if (!loadAmplifyOutputs()) {
        throw new Error('Amplify belum dikonfigurasi.');
      }
      const client = getDataClient();
      const { errors } = await client.models.Notification.update({
        id: notificationId,
        read: true,
      });
      if (errors?.length) {
        throw new Error(errors[0]?.message ?? 'Gagal menandai notifikasi dibaca');
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Label jenis notifikasi
// ---------------------------------------------------------------------------

const NOTIF_PREFIXES: Array<[string, string]> = [
  ['budget80', 'Anggaran'],
  ['budget100', 'Anggaran'],
  ['recrem', 'Tagihan Berulang'],
  ['goal-done', 'Target Tabungan'],
  ['insight', 'Wawasan Mingguan'],
];

function getTypeLabel(type: string | null | undefined): string {
  if (!type) return 'Notifikasi';
  const match = NOTIF_PREFIXES.find(([prefix]) => type.startsWith(prefix));
  return match ? match[1] : 'Notifikasi';
}

// ---------------------------------------------------------------------------
// Komponen: satu kartu notifikasi
// ---------------------------------------------------------------------------

interface NotificationCardProps {
  item: NotificationItem;
  onMarkRead: (id: string) => void;
  isPending: boolean;
}

function NotificationCard({ item, onMarkRead, isPending }: NotificationCardProps) {
  const isUnread = !item.read;
  // `createdAt` adalah ISO datetime; ambil bagian tanggal YYYY-MM-DD saja.
  const dateStr = item.createdAt ? item.createdAt.slice(0, 10) : '';

  const cardContent = (
    <SoftCard
      style={{
        padding: 16,
        opacity: isPending ? 0.6 : 1,
        transition: 'opacity 150ms',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        {/* Penanda belum dibaca: titik biru (Req 17.3 — bukan hanya warna) */}
        <span
          aria-hidden="true"
          style={{
            marginTop: 6,
            width: 8,
            height: 8,
            borderRadius: '50%',
            backgroundColor: isUnread
              ? 'var(--color-brand-blue, #005DAC)'
              : 'transparent',
            flexShrink: 0,
            display: 'inline-block',
          }}
        />

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Baris judul + badge teks "Baru" */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: 8,
            }}
          >
            <p
              style={{
                margin: 0,
                fontWeight: isUnread ? 600 : 400,
                fontSize: 'var(--font-size-body, 16px)',
                color: 'var(--color-ink, #1f2430)',
                flex: 1,
                minWidth: 0,
              }}
            >
              {item.title}
            </p>
            {/* Teks "Baru" memenuhi syarat penanda belum-dibaca yang tidak hanya mengandalkan warna */}
            {isUnread && (
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--color-brand-blue, #005DAC)',
                  fontWeight: 700,
                  flexShrink: 0,
                  backgroundColor: 'rgba(0, 93, 172, 0.10)',
                  padding: '2px 8px',
                  borderRadius: 999,
                  lineHeight: '18px',
                }}
              >
                Baru
              </span>
            )}
          </div>

          {/* Isi notifikasi */}
          {item.body ? (
            <p
              style={{
                margin: '4px 0 0',
                fontSize: 'var(--font-size-caption, 13px)',
                color: 'var(--color-ink-muted, #6b7280)',
                lineHeight: 1.5,
              }}
            >
              {item.body}
            </p>
          ) : null}

          {/* Metadata: jenis dan tanggal */}
          <div
            style={{
              marginTop: 6,
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '2px 8px',
            }}
          >
            <span
              style={{
                fontSize: 11,
                color: 'var(--color-ink-muted, #6b7280)',
                fontWeight: 500,
              }}
            >
              {getTypeLabel(item.type)}
            </span>
            {dateStr ? (
              <>
                <span
                  aria-hidden="true"
                  style={{ fontSize: 11, color: 'var(--color-ink-muted, #6b7280)' }}
                >
                  ·
                </span>
                <DateDisplay
                  date={dateStr}
                  style={{
                    fontSize: 11,
                    color: 'var(--color-ink-muted, #6b7280)',
                  }}
                />
              </>
            ) : null}
          </div>
        </div>
      </div>
    </SoftCard>
  );

  // Notifikasi belum dibaca dibungkus tombol agar dapat diketuk (Req 9.2)
  if (isUnread) {
    return (
      <button
        type="button"
        onClick={() => onMarkRead(item.id)}
        disabled={isPending}
        aria-label={`Tandai dibaca: ${item.title}`}
        style={{
          display: 'block',
          width: '100%',
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: isPending ? 'default' : 'pointer',
          textAlign: 'left',
        }}
      >
        {cardContent}
      </button>
    );
  }

  return <div>{cardContent}</div>;
}

// ---------------------------------------------------------------------------
// Halaman utama
// ---------------------------------------------------------------------------

export function NotificationsPage() {
  const { data: notifications, isPending: loading, isError } = useNotifications();
  const unreadCount = useUnreadCount();
  const markAsRead = useMarkAsRead();

  const items = notifications ?? [];

  const handleMarkRead = (id: string) => {
    markAsRead.mutate(id);
  };

  // Judul besar menyertakan jumlah belum-dibaca sebagai informasi tambahan
  const pageTitle =
    unreadCount > 0 ? `Notifikasi (${unreadCount})` : 'Notifikasi';

  return (
    <div style={{ paddingBottom: 32 }}>
      <LargeTitle title={pageTitle} compact="Notifikasi" />

      <section
        aria-label="Daftar notifikasi"
        style={{ padding: '8px 16px 0' }}
      >
        {/* Skeleton saat memuat */}
        {loading && (
          <div
            style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
            aria-label="Memuat notifikasi"
          >
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} height={88} radius="var(--radius-card, 20px)" />
            ))}
          </div>
        )}

        {/* Galat */}
        {!loading && isError && (
          <EmptyState
            icon="⚠️"
            title="Gagal memuat notifikasi"
            description="Periksa koneksi internet Anda dan coba lagi."
          />
        )}

        {/* Keadaan kosong */}
        {!loading && !isError && items.length === 0 && (
          <EmptyState
            icon="🔔"
            title="Belum ada notifikasi"
            description="Notifikasi anggaran, tagihan berulang, target tabungan, dan wawasan mingguan akan tampil di sini."
          />
        )}

        {/* Daftar notifikasi */}
        {!loading && !isError && items.length > 0 && (
          <ul
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            {items.map((item) => (
              <li key={item.id}>
                <NotificationCard
                  item={item}
                  onMarkRead={handleMarkRead}
                  isPending={
                    markAsRead.isPending &&
                    markAsRead.variables === item.id
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default NotificationsPage;
