/** Rasio geser (terhadap tinggi lembar) minimal untuk menutup Lembar_Bawah. */
export const DISMISS_RATIO = 0.35;
/** Kecepatan geser ke bawah minimal (px/ms) untuk menutup Lembar_Bawah. */
export const DISMISS_VELOCITY = 0.5;

/**
 * Menentukan apakah Lembar_Bawah harus ditutup setelah geser dilepas.
 * dragY positif = geser ke bawah; velocityPxPerMs positif = ke bawah.
 * Geser ke atas (dragY <= 0) tidak pernah menutup.
 */
export function shouldDismissSheet(
  dragY: number,
  sheetHeight: number,
  velocityPxPerMs: number,
): boolean {
  if (!(dragY > 0)) return false;
  const byRatio = sheetHeight > 0 && dragY / sheetHeight >= DISMISS_RATIO;
  const byVelocity = velocityPxPerMs >= DISMISS_VELOCITY;
  return byRatio || byVelocity;
}
