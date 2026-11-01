// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * Uji Sidebar / Panel_Samping.
 *
 * Mencakup kontrak aksesibilitas drawer (dialog modal, Escape, scrim, fokus)
 * dan kelengkapan tujuan yang dipindah dari grid "Menu" di Beranda.
 */
import { Sidebar, SIDEBAR_GROUPS } from './Sidebar';

afterEach(cleanup);

function renderSidebar(open: boolean, path = '/') {
  const onClose = vi.fn();
  const utils = render(
    <MemoryRouter initialEntries={[path]}>
      <Sidebar open={open} onClose={onClose} />
    </MemoryRouter>,
  );
  return { onClose, ...utils };
}

const ALL_ITEMS = SIDEBAR_GROUPS.flatMap((g) => g.items);

describe('Sidebar - render', () => {
  it('tidak merender apa pun saat tertutup', () => {
    const { container } = renderSidebar(false);
    expect(container.querySelector('.arto-sidebar')).toBeNull();
  });

  it('merender dialog modal berlabel saat terbuka', () => {
    renderSidebar(true);
    const dialog = screen.getByRole('dialog', { name: 'Menu Arto' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('memuat seluruh tujuan sekunder yang dipindah dari Beranda', () => {
    renderSidebar(true);
    expect(ALL_ITEMS).toHaveLength(11);
    for (const item of ALL_ITEMS) {
      expect(
        screen.getByRole('button', { name: item.label }),
        `Item "${item.label}" tidak ditemukan`,
      ).not.toBeNull();
    }
  });

  it('mengelompokkan tujuan dengan label kelompok', () => {
    renderSidebar(true);
    for (const group of SIDEBAR_GROUPS) {
      expect(screen.getByText(group.label)).not.toBeNull();
    }
  });

  it('menandai halaman aktif dengan aria-current, bukan hanya warna', () => {
    renderSidebar(true, '/anggaran');
    expect(screen.getByRole('button', { name: 'Anggaran' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(screen.getByRole('button', { name: 'Dompet' }).getAttribute('aria-current')).toBeNull();
  });

  it('setiap item memenuhi target sentuh lewat kelas item', () => {
    const { container } = renderSidebar(true);
    expect(container.querySelectorAll('.arto-sidebar__item')).toHaveLength(ALL_ITEMS.length);
  });
});

describe('Sidebar - cara menutup', () => {
  it('menutup lewat tombol Tutup menu', () => {
    const { onClose } = renderSidebar(true);
    fireEvent.click(screen.getByRole('button', { name: 'Tutup menu' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('menutup lewat Escape', () => {
    const { onClose } = renderSidebar(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('menutup lewat klik scrim', () => {
    const { onClose, container } = renderSidebar(true);
    fireEvent.click(container.querySelector('.arto-sidebar-scrim') as HTMLElement);
    expect(onClose).toHaveBeenCalled();
  });

  it('menutup saat sebuah tujuan dipilih', () => {
    const { onClose } = renderSidebar(true);
    fireEvent.click(screen.getByRole('button', { name: 'Laporan' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('tidak menutup pada tombol selain Escape', () => {
    const { onClose } = renderSidebar(true);
    fireEvent.keyDown(document, { key: 'a' });
    expect(onClose).not.toHaveBeenCalled();
  });
});