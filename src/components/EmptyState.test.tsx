// @vitest-environment jsdom
import { describe, expect, it, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { EmptyState } from './EmptyState';

afterEach(cleanup);

describe('EmptyState', () => {
  it('menampilkan judul yang diberikan', () => {
    render(<EmptyState title="Belum ada transaksi" />);
    expect(screen.getByText('Belum ada transaksi')).not.toBeNull();
  });

  it('menampilkan deskripsi bila disuplai', () => {
    render(
      <EmptyState
        title="Tidak ada data"
        description="Mulai tambah transaksi untuk melihat laporan"
      />,
    );
    expect(screen.getByText('Mulai tambah transaksi untuk melihat laporan')).not.toBeNull();
  });

  it('menampilkan ikon bila disuplai', () => {
    const { container } = render(<EmptyState title="Kosong" icon="📭" />);
    expect(container.textContent).toContain('📭');
  });

  it('menampilkan komponen aksi bila disuplai', () => {
    render(
      <EmptyState
        title="Kosong"
        action={<button type="button">Tambah</button>}
      />,
    );
    expect(screen.getByRole('button', { name: 'Tambah' })).not.toBeNull();
  });

  it('memakai role status untuk pengumuman pembaca layar', () => {
    render(<EmptyState title="Tidak ada data untuk diekspor" />);
    expect(screen.getByRole('status')).not.toBeNull();
  });

  it('tidak menampilkan deskripsi bila tidak disuplai', () => {
    const { container } = render(<EmptyState title="Judul saja" />);
    const paragraphs = container.querySelectorAll('p');
    expect(paragraphs.length).toBe(1);
  });
});
