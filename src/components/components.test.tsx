// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { GlassBar } from './GlassBar';
import { SoftCard } from './SoftCard';
import { LargeTitle } from './LargeTitle';
import { Skeleton } from './Skeleton';

afterEach(cleanup);

describe('GlassBar', () => {
  it('memakai kelas Permukaan_Kaca `.glass` dan merender header di atas secara default', () => {
    const { container } = render(<GlassBar>Beranda</GlassBar>);
    const bar = container.querySelector('header');
    expect(bar).not.toBeNull();
    expect(bar?.classList.contains('glass')).toBe(true);
    expect(bar?.classList.contains('arto-glass-bar--top')).toBe(true);
  });

  it('merender nav untuk bilah bawah', () => {
    const { container } = render(<GlassBar position="bottom">Nav</GlassBar>);
    const bar = container.querySelector('nav');
    expect(bar?.classList.contains('arto-glass-bar--bottom')).toBe(true);
  });
});

describe('SoftCard', () => {
  it('memakai kelas Kartu_Lembut `.soft-card`', () => {
    const { container } = render(<SoftCard>Isi</SoftCard>);
    const card = container.querySelector('div');
    expect(card?.classList.contains('soft-card')).toBe(true);
    expect(card?.classList.contains('arto-soft-card')).toBe(true);
  });
});

describe('LargeTitle', () => {
  it('menampilkan Judul_Besar dan judul ringkas', () => {
    render(<LargeTitle title="Halo, Budi" compact="Beranda" />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Halo, Budi');
    expect(screen.getByText('Beranda')).not.toBeNull();
  });
});

describe('Skeleton', () => {
  it('menandai keadaan memuat untuk pembaca layar', () => {
    render(<Skeleton lines={3} />);
    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByText('Memuat data')).not.toBeNull();
    expect(status.querySelectorAll('.arto-skeleton').length).toBe(3);
  });
});
