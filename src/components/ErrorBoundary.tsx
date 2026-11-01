/**
 * ErrorBoundary — menangkap galat React yang tidak tertangani dan menampilkan
 * fallback berbahasa Indonesia (Req 15.1).
 *
 * Komponen ini adalah class component karena React belum mendukung Error
 * Boundary menggunakan function component (hingga React 18). Ia menampilkan
 * pesan galat ramah dengan opsi "Coba lagi" yang me-reset state boundary.
 */
import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

export interface ErrorBoundaryProps {
  /** Konten yang dipantau galat-nya. */
  children: ReactNode;
  /**
   * Komponen fallback kustom. Bila tidak disuplai, fallback bawaan berbahasa
   * Indonesia ditampilkan.
   */
  fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode);
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
    this.reset = this.reset.bind(this);
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Catat ke konsol tanpa memuat data keuangan sensitif (Req 16.4).
    console.error('[ErrorBoundary]', error.message, info.componentStack?.slice(0, 200));
  }

  reset(): void {
    this.setState({ error: null });
  }

  render(): ReactNode {
    const { error } = this.state;
    const { children, fallback } = this.props;

    if (!error) return children;

    if (fallback !== undefined) {
      return typeof fallback === 'function' ? fallback(error, this.reset) : fallback;
    }

    return (
      <div
        role="alert"
        aria-live="assertive"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 16,
          padding: '48px 24px',
          textAlign: 'center',
          color: 'var(--color-ink, #1f2430)',
        }}
      >
        <span aria-hidden="true" style={{ fontSize: 48, lineHeight: 1 }}>
          ⚠️
        </span>

        <p
          style={{
            margin: 0,
            fontSize: 'var(--font-size-body, 16px)',
            fontWeight: 600,
          }}
        >
          Terjadi kesalahan
        </p>

        <p
          style={{
            margin: 0,
            fontSize: 'var(--font-size-caption, 13px)',
            color: 'var(--color-ink-muted, #6b7280)',
            lineHeight: 1.5,
          }}
        >
          Maaf, bagian ini tidak dapat dimuat. Silakan coba lagi.
        </p>

        <button
          type="button"
          onClick={this.reset}
          style={{
            minWidth: 44,
            minHeight: 44,
            padding: '10px 24px',
            border: 'none',
            borderRadius: 'var(--radius-card, 20px)',
            background: 'var(--color-brand-blue, #005dac)',
            color: 'var(--color-onBlue, #ffffff)',
            fontSize: 'var(--font-size-body, 16px)',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Coba lagi
        </button>
      </div>
    );
  }
}

export default ErrorBoundary;
