// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BottomSheet } from './BottomSheet';

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

function renderSheet(props: Partial<Parameters<typeof BottomSheet>[0]> = {}) {
  const onClose = vi.fn();
  const utils = render(
    <BottomSheet open title="Tambah Transaksi" onClose={onClose} {...props}>
      <button type="button">Simpan</button>
    </BottomSheet>,
  );
  return { onClose, ...utils };
}

describe('BottomSheet - dialog modal berlabel', () => {
  it('merender dialog dengan aria-modal dan label dari judul', () => {
    renderSheet();
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy as string)?.textContent).toBe(
      'Tambah Transaksi',
    );
  });

  it('tidak merender apa pun saat tertutup', () => {
    renderSheet({ open: false });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('BottomSheet - cara menutup', () => {
  it('menutup lewat klik scrim', () => {
    const { onClose, container } = renderSheet();
    const scrim = container.querySelector('.arto-sheet-scrim') as HTMLElement;
    fireEvent.click(scrim);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('menutup lewat tombol Tutup 44 px', () => {
    const { onClose } = renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Tutup' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('menutup lewat tombol Escape', () => {
    const { onClose } = renderSheet();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('menutup saat geser ke bawah melewati ambang (shouldDismissSheet)', () => {
    const { onClose, container } = renderSheet();
    const handle = container.querySelector('.arto-sheet__handle-area') as HTMLElement;
    const sheet = container.querySelector('.arto-sheet') as HTMLElement;
    // jsdom tak menghitung layout; paksa tinggi lembar agar rasio geser terukur.
    Object.defineProperty(sheet, 'offsetHeight', { value: 400, configurable: true });

    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 0, timeStamp: 0 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 300, timeStamp: 100 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 300, timeStamp: 100 });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('tidak menutup saat geser kecil di bawah ambang', () => {
    const { onClose, container } = renderSheet();
    const handle = container.querySelector('.arto-sheet__handle-area') as HTMLElement;
    const sheet = container.querySelector('.arto-sheet') as HTMLElement;
    Object.defineProperty(sheet, 'offsetHeight', { value: 400, configurable: true });

    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 0, timeStamp: 0 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 20, timeStamp: 400 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 20, timeStamp: 400 });

    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('BottomSheet - fokus dan latar inert', () => {
  it('mengembalikan fokus ke pemicu saat ditutup', async () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Buka';
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const onClose = vi.fn();
    const { rerender } = render(
      <BottomSheet open title="Tambah" onClose={onClose}>
        <button type="button">Simpan</button>
      </BottomSheet>,
    );

    // Lembar terbuka memindahkan fokus ke dalam dialog.
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    expect(document.activeElement).not.toBe(trigger);

    rerender(
      <BottomSheet open={false} title="Tambah" onClose={onClose}>
        <button type="button">Simpan</button>
      </BottomSheet>,
    );

    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('menandai saudara di luar lembar sebagai inert saat terbuka', () => {
    const sibling = document.createElement('div');
    document.body.appendChild(sibling);

    render(
      <BottomSheet open title="Tambah" onClose={() => {}}>
        <button type="button">Simpan</button>
      </BottomSheet>,
    );

    expect(sibling.hasAttribute('inert')).toBe(true);
    sibling.remove();
  });
});
