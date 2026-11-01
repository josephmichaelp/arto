/**
 * DateDisplay — menampilkan tanggal dalam format Indonesia "17 Agustus 2025"
 * menurut Zona_Waktu_Pengguna (WIB) (Req 15.3).
 *
 * Menerima string `YYYY-MM-DD` (tanggal kalender WIB yang sudah tersimpan
 * di DynamoDB) dan meneruskannya ke `formatDateId` dari domain murni.
 * Bila format tidak valid, menampilkan teks fallback "Tanggal tidak valid"
 * agar UI tidak crash.
 */
import type { HTMLAttributes } from 'react';
import { formatDateId } from 'shared/domain/dates';

export interface DateDisplayProps extends Omit<HTMLAttributes<HTMLTimeElement>, 'children'> {
  /** Tanggal kalender format `YYYY-MM-DD`. */
  date: string;
  /** Teks fallback bila format tidak valid. Default: "Tanggal tidak valid". */
  fallback?: string;
}

export function DateDisplay({ date, fallback = 'Tanggal tidak valid', className, ...rest }: DateDisplayProps) {
  let formatted: string;
  try {
    formatted = formatDateId(date);
  } catch {
    formatted = fallback;
  }

  return (
    <time
      dateTime={date}
      className={['arto-date', className].filter(Boolean).join(' ')}
      {...rest}
    >
      {formatted}
    </time>
  );
}

export default DateDisplay;
