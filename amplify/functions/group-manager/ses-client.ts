/**
 * Klien SES untuk pengiriman email undangan grup.
 *
 * Menggunakan @aws-sdk/client-ses yang tersedia di runtime Lambda Node.js 22.
 * Dapat di-mock untuk uji unit via parameter `clientOverride`.
 */
import {
  SESClient,
  SendEmailCommand,
  type SendEmailCommandInput,
} from '@aws-sdk/client-ses';
import type { InviteRole } from './invite-token';

let sharedClient: SESClient | undefined;

function getClient(): SESClient {
  if (!sharedClient) {
    sharedClient = new SESClient({});
  }
  return sharedClient;
}

/** Mengosongkan klien bersama (untuk pengujian). */
export function resetSesClient(): void {
  sharedClient = undefined;
}

export interface SendInvitationParams {
  to: string;
  fromEmail: string;
  inviterName: string;
  groupName: string;
  role: InviteRole;
  inviteUrl: string;
  /** Override klien SES untuk pengujian. */
  clientOverride?: SESClient;
}

const ROLE_LABEL: Record<InviteRole, string> = {
  CO_OWNER: 'Ko-Pemilik (dapat mencatat dan mengubah data)',
  VIEWER: 'Penonton (hanya dapat melihat data)',
};

/**
 * Mengirim email undangan keanggotaan grup via Amazon SES.
 *
 * Pesan berbahasa Indonesia; format teks (tidak HTML) agar kompatibel
 * dengan seluruh klien email tanpa kerumitan rendering HTML.
 */
export async function sendInvitationEmail(params: SendInvitationParams): Promise<void> {
  const { to, fromEmail, inviterName, groupName, role, inviteUrl, clientOverride } = params;
  const client = clientOverride ?? getClient();

  const roleLabel = ROLE_LABEL[role];

  const body =
    `Halo,\n\n` +
    `${inviterName} mengundang Anda untuk bergabung ke grup keuangan bersama ` +
    `"${groupName}" di Arto sebagai ${roleLabel}.\n\n` +
    `Klik tautan berikut untuk bergabung (berlaku 7 hari):\n` +
    `${inviteUrl}\n\n` +
    `Jika Anda tidak mengenal ${inviterName} atau tidak ingin bergabung, ` +
    `abaikan email ini.\n\n` +
    `—\n` +
    `Tim Arto\n` +
    `Pengelola keuangan pribadi berbasis AI`;

  const input: SendEmailCommandInput = {
    Source: `Arto <${fromEmail}>`,
    Destination: { ToAddresses: [to] },
    Message: {
      Subject: {
        Data: `[Arto] ${inviterName} mengundang Anda ke "${groupName}"`,
        Charset: 'UTF-8',
      },
      Body: {
        Text: { Data: body, Charset: 'UTF-8' },
      },
    },
  };

  await client.send(new SendEmailCommand(input));
}
