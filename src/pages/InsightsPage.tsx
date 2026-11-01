/**
 * InsightsPage — Halaman Wawasan Mingguan (Tugas 12.12).
 *
 * Menampilkan daftar kartu wawasan mingguan yang dihasilkan AI, terurut dari
 * yang terbaru. Setiap kartu menampilkan:
 * - Tanggal mulai minggu (format Indonesia)
 * - Total pengeluaran minggu tersebut
 * - Kategori teratas
 * - Ringkasan AI
 * - Daftar tips AI
 *
 * Design System: LargeTitle, SoftCard, Skeleton, EmptyState, DateDisplay,
 * AmountDisplay.
 *
 * Requirements: 13.1, 13.2, 13.5, 15.3, 15.7, 17.3, 17.9, 17.10
 */

import { useMemo } from 'react';
import { LargeTitle } from '../components/LargeTitle';
import { SoftCard } from '../components/SoftCard';
import { Skeleton } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { DateDisplay } from '../components/DateDisplay';
import { AmountDisplay } from '../components/AmountDisplay';
import { useWeeklyInsights } from '../hooks/useWeeklyInsights';
import { useCategories } from '../hooks/useCategories';
import type { WeeklyInsightItem } from '../hooks/useWeeklyInsights';

// ---------------------------------------------------------------------------
// Komponen: satu kartu wawasan
// ---------------------------------------------------------------------------

interface InsightCardProps {
  insight: WeeklyInsightItem;
  categoryName: string | undefined;
}

function InsightCard({ insight, categoryName }: InsightCardProps) {
  const tips = insight.tips ?? [];

  return (
    <SoftCard
      style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}
    >
      {/* Header: tanggal mulai minggu */}
      <div>
        <p
          style={{
            margin: 0,
            fontSize: 'var(--font-size-caption, 13px)',
            color: 'var(--color-ink-muted, #6b7280)',
            fontWeight: 500,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          Minggu mulai
        </p>
        <DateDisplay
          date={insight.weekStart}
          style={{
            fontSize: 'var(--font-size-body, 16px)',
            fontWeight: 600,
            color: 'var(--color-ink, #1f2430)',
          }}
        />
      </div>

      {/* Baris statistik: total pengeluaran & kategori teratas */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 16,
        }}
      >
        {/* Total pengeluaran */}
        {insight.totalExpense != null && (
          <div style={{ minWidth: 0 }}>
            <p
              style={{
                margin: 0,
                fontSize: 'var(--font-size-caption, 13px)',
                color: 'var(--color-ink-muted, #6b7280)',
              }}
            >
              Total pengeluaran
            </p>
            <AmountDisplay
              amount={insight.totalExpense}
              variant="expense"
              style={{
                fontSize: 'var(--font-size-body, 16px)',
                fontWeight: 700,
                display: 'block',
              }}
            />
          </div>
        )}

        {/* Kategori teratas */}
        {categoryName && (
          <div style={{ minWidth: 0 }}>
            <p
              style={{
                margin: 0,
                fontSize: 'var(--font-size-caption, 13px)',
                color: 'var(--color-ink-muted, #6b7280)',
              }}
            >
              Kategori terbanyak
            </p>
            <p
              style={{
                margin: 0,
                fontSize: 'var(--font-size-body, 16px)',
                fontWeight: 600,
                color: 'var(--color-ink, #1f2430)',
              }}
            >
              {categoryName}
            </p>
          </div>
        )}
      </div>

      {/* Ringkasan AI */}
      {insight.summary && (
        <div>
          <p
            style={{
              margin: '0 0 4px',
              fontSize: 'var(--font-size-caption, 13px)',
              color: 'var(--color-ink-muted, #6b7280)',
              fontWeight: 500,
            }}
          >
            Ringkasan
          </p>
          <p
            style={{
              margin: 0,
              fontSize: 'var(--font-size-body, 16px)',
              color: 'var(--color-ink, #1f2430)',
              lineHeight: 1.6,
            }}
          >
            {insight.summary}
          </p>
        </div>
      )}

      {/* Tips AI */}
      {tips.length > 0 && (
        <div>
          <p
            style={{
              margin: '0 0 6px',
              fontSize: 'var(--font-size-caption, 13px)',
              color: 'var(--color-ink-muted, #6b7280)',
              fontWeight: 500,
            }}
          >
            Tips
          </p>
          <ul
            style={{
              margin: 0,
              paddingLeft: 20,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            {tips.map((tip, index) => (
              <li
                key={index}
                style={{
                  fontSize: 'var(--font-size-body, 16px)',
                  color: 'var(--color-ink, #1f2430)',
                  lineHeight: 1.5,
                }}
              >
                {tip}
              </li>
            ))}
          </ul>
        </div>
      )}
    </SoftCard>
  );
}

// ---------------------------------------------------------------------------
// Halaman utama
// ---------------------------------------------------------------------------

export function InsightsPage() {
  const { data: insights, isPending: insightsPending, isError } = useWeeklyInsights();
  const { data: categories } = useCategories();

  // Peta categoryId → nama untuk pencarian cepat
  const categoryMap = useMemo(() => {
    const map = new Map<string, string>();
    (categories ?? []).forEach((c) => map.set(c.id, c.name ?? c.id));
    return map;
  }, [categories]);

  const items = insights ?? [];

  return (
    <div style={{ paddingBottom: 32 }}>
      <LargeTitle title="Wawasan" />

      <section
        aria-label="Daftar wawasan mingguan"
        style={{ padding: '8px 16px 0' }}
      >
        {/* Skeleton saat memuat */}
        {insightsPending && (
          <div
            style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
            aria-label="Memuat wawasan"
          >
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} height={180} radius="var(--radius-card, 20px)" />
            ))}
          </div>
        )}

        {/* Galat */}
        {!insightsPending && isError && (
          <EmptyState
            icon="⚠️"
            title="Gagal memuat wawasan"
            description="Periksa koneksi internet Anda dan coba lagi."
          />
        )}

        {/* Keadaan kosong */}
        {!insightsPending && !isError && items.length === 0 && (
          <EmptyState
            icon="💡"
            title="Belum ada wawasan"
            description="Wawasan mingguan akan muncul secara otomatis setelah Anda mencatat pengeluaran selama seminggu."
          />
        )}

        {/* Daftar kartu wawasan */}
        {!insightsPending && !isError && items.length > 0 && (
          <ul
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            {items.map((insight) => (
              <li key={insight.id}>
                <InsightCard
                  insight={insight}
                  categoryName={
                    insight.topCategoryId
                      ? categoryMap.get(insight.topCategoryId)
                      : undefined
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

export default InsightsPage;
