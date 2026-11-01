/**
 * SettingsPage — Halaman Pengaturan (Tugas 12.13).
 *
 * Menyediakan:
 * - Preferensi jenis Notifikasi (anggaran, tagihan berulang, target, wawasan)
 *   via toggle yang memperbarui model NotifPrefs langsung ke AppSync.
 * - Tombol Keluar menggunakan useAuthenticator.
 * - Informasi versi aplikasi.
 *
 * Design System: LargeTitle, SoftCard, Skeleton.
 *
 * Requirements: 9.3, 9.5, 15.7, 17.3, 17.9, 17.10
 */

import { useAuthenticator } from '@aws-amplify/ui-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LargeTitle } from '../components/LargeTitle';
import { SoftCard } from '../components/SoftCard';
import { Skeleton } from '../components/Skeleton';
import { useNotifPrefs } from '../hooks';
import type { NotifPrefsItem } from '../hooks';
import { loadAmplifyOutputs } from '../app/amplify';
import { getDataClient } from '../app/dataClient';

// ---------------------------------------------------------------------------
// Konstanta
// ---------------------------------------------------------------------------

const APP_VERSION = '0.1.0';

type PrefsKey = 'budget' | 'recurring' | 'goal' | 'insight';

interface PrefsMeta {
  label: string;
  description: string;
}

const PREFS_META: Record<PrefsKey, PrefsMeta> = {
  budget: {
    label: 'Anggaran',
    description: 'Pemberitahuan saat anggaran mencapai 80% atau terlampaui',
  },
  recurring: {
    label: 'Tagihan Berulang',
    description: 'Pengingat tagihan dan langganan yang akan jatuh tempo',
  },
  goal: {
    label: 'Target Tabungan',
    description: 'Pemberitahuan saat target tabungan tercapai',
  },
  insight: {
    label: 'Wawasan Mingguan',
    description: 'Ringkasan dan saran keuangan mingguan dari AI',
  },
};

const PREFS_KEYS = Object.keys(PREFS_META) as PrefsKey[];

// ---------------------------------------------------------------------------
// Mutation: perbarui preferensi notifikasi
// ---------------------------------------------------------------------------

interface UpdatePrefsPayload {
  prefs: NotifPrefsItem | null;
  key: PrefsKey;
  value: boolean;
}

function useUpdateNotifPrefs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ prefs, key, value }: UpdatePrefsPayload) => {
      if (!loadAmplifyOutputs()) {
        throw new Error('Amplify belum dikonfigurasi.');
      }
      const client = getDataClient();

      if (prefs?.id) {
        // Perbarui rekaman yang sudah ada
        const { errors } = await client.models.NotifPrefs.update({
          id: prefs.id,
          [key]: value,
        });
        if (errors?.length) {
          throw new Error(errors[0]?.message ?? 'Gagal memperbarui preferensi notifikasi');
        }
      } else {
        // Buat rekaman baru dengan nilai default aktif, kecuali kunci yang diubah
        const newPrefs: Record<string, boolean> = {
          budget: true,
          recurring: true,
          goal: true,
          insight: true,
          [key]: value,
        };
        const { errors } = await client.models.NotifPrefs.create(newPrefs);
        if (errors?.length) {
          throw new Error(errors[0]?.message ?? 'Gagal membuat preferensi notifikasi');
        }
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notif-prefs'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Komponen: baris toggle satu preferensi
// ---------------------------------------------------------------------------

interface PrefsToggleRowProps {
  prefKey: PrefsKey;
  label: string;
  description: string;
  enabled: boolean;
  disabled: boolean;
  onToggle: (key: PrefsKey) => void;
  showDivider: boolean;
}

function PrefsToggleRow({
  prefKey,
  label,
  description,
  enabled,
  disabled,
  onToggle,
  showDivider,
}: PrefsToggleRowProps) {
  const inputId = `notif-pref-${prefKey}`;

  return (
    <>
      <label
        htmlFor={inputId}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 16px',
          gap: 16,
          cursor: disabled ? 'default' : 'pointer',
          opacity: disabled ? 0.6 : 1,
          transition: 'opacity 150ms',
          // Pastikan target sentuh minimal 44 px (Req 15.4)
          minHeight: 44,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            style={{
              margin: 0,
              fontSize: 'var(--font-size-body, 16px)',
              color: 'var(--color-ink, #1f2430)',
              fontWeight: 500,
            }}
          >
            {label}
          </p>
          <p
            style={{
              margin: '2px 0 0',
              fontSize: 'var(--font-size-caption, 13px)',
              color: 'var(--color-ink-muted, #6b7280)',
              lineHeight: 1.4,
            }}
          >
            {description}
          </p>
        </div>
        <input
          id={inputId}
          type="checkbox"
          role="switch"
          checked={enabled}
          onChange={() => onToggle(prefKey)}
          disabled={disabled}
          aria-checked={enabled}
          aria-label={`Notifikasi ${label} ${enabled ? 'aktif' : 'nonaktif'}`}
          style={{
            width: 44,
            height: 24,
            cursor: disabled ? 'default' : 'pointer',
            accentColor: 'var(--color-brand-blue, #005DAC)',
            flexShrink: 0,
          }}
        />
      </label>
      {showDivider && (
        <div
          aria-hidden="true"
          style={{
            height: 1,
            backgroundColor: 'var(--color-separator, rgba(0,0,0,0.08))',
            marginLeft: 16,
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Halaman utama
// ---------------------------------------------------------------------------

export function SettingsPage() {
  const { user, signOut } = useAuthenticator((ctx) => [ctx.user]);
  const { data: prefs, isPending: prefsLoading } = useNotifPrefs();
  const updatePrefs = useUpdateNotifPrefs();

  // Email atau nama pengguna yang ditampilkan
  const displayEmail =
    user?.signInDetails?.loginId ?? user?.username ?? 'Pengguna';

  const handleToggle = (key: PrefsKey) => {
    const current = prefs?.[key] ?? true;
    updatePrefs.mutate({ prefs: prefs ?? null, key, value: !current });
  };

  return (
    <div style={{ paddingBottom: 40 }}>
      <LargeTitle title="Pengaturan" />

      <div
        style={{
          padding: '8px 16px 0',
          display: 'flex',
          flexDirection: 'column',
          gap: 24,
        }}
      >
        {/* ----------------------------------------------------------------
            Seksi: Akun
        ---------------------------------------------------------------- */}
        <section aria-labelledby="section-akun">
          <p
            id="section-akun"
            style={{
              margin: '0 0 8px 4px',
              fontSize: 11,
              color: 'var(--color-ink-muted, #6b7280)',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            Akun
          </p>
          <SoftCard style={{ padding: '14px 16px' }}>
            <p
              style={{
                margin: 0,
                fontSize: 'var(--font-size-body, 16px)',
                color: 'var(--color-ink, #1f2430)',
                fontWeight: 500,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {displayEmail}
            </p>
          </SoftCard>
        </section>

        {/* ----------------------------------------------------------------
            Seksi: Preferensi Notifikasi
        ---------------------------------------------------------------- */}
        <section aria-labelledby="section-notifikasi">
          <p
            id="section-notifikasi"
            style={{
              margin: '0 0 8px 4px',
              fontSize: 11,
              color: 'var(--color-ink-muted, #6b7280)',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            Notifikasi
          </p>

          {prefsLoading ? (
            <SoftCard style={{ padding: 16 }}>
              <Skeleton lines={4} height={48} label="Memuat preferensi notifikasi" />
            </SoftCard>
          ) : (
            <SoftCard noPadding style={{ overflow: 'hidden' }}>
              {PREFS_KEYS.map((key, idx) => {
                const { label, description } = PREFS_META[key];
                const enabled = prefs?.[key] ?? true;
                return (
                  <PrefsToggleRow
                    key={key}
                    prefKey={key}
                    label={label}
                    description={description}
                    enabled={enabled}
                    disabled={updatePrefs.isPending}
                    onToggle={handleToggle}
                    showDivider={idx < PREFS_KEYS.length - 1}
                  />
                );
              })}
            </SoftCard>
          )}
        </section>

        {/* ----------------------------------------------------------------
            Seksi: Tombol Keluar
        ---------------------------------------------------------------- */}
        <section aria-label="Keluar dari aplikasi">
          <SoftCard noPadding style={{ overflow: 'hidden' }}>
            <button
              type="button"
              onClick={signOut}
              style={{
                width: '100%',
                padding: '14px 16px',
                textAlign: 'left',
                fontSize: 'var(--font-size-body, 16px)',
                color: 'var(--color-expense, #c0392b)',
                fontWeight: 600,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                display: 'block',
                // Memenuhi target sentuh minimal 44 px (Req 15.4)
                minHeight: 44,
              }}
              aria-label={`Keluar dari akun ${displayEmail}`}
            >
              Keluar
            </button>
          </SoftCard>
        </section>

        {/* ----------------------------------------------------------------
            Versi aplikasi
        ---------------------------------------------------------------- */}
        <p
          style={{
            margin: 0,
            textAlign: 'center',
            fontSize: 'var(--font-size-caption, 13px)',
            color: 'var(--color-ink-muted, #6b7280)',
          }}
        >
          Arto versi {APP_VERSION}
        </p>
      </div>
    </div>
  );
}

export default SettingsPage;
