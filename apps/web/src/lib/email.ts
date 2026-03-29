import { Resend } from 'resend'

const resend = process.env.AUTH_RESEND_KEY ? new Resend(process.env.AUTH_RESEND_KEY) : null
const fromAddress = process.env.EMAIL_FROM || 'Aeon <noreply@aeon.app>'

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export async function sendInviteEmail(to: string, projectName: string, inviterName: string, inviteUrl: string) {
  if (!resend) return
  if (!inviteUrl.startsWith('http://') && !inviteUrl.startsWith('https://')) return

  const safeName = esc(projectName)
  const safeInviter = esc(inviterName)
  const safeUrl = esc(inviteUrl)

  await resend.emails.send({
    from: fromAddress,
    to,
    subject: `You've been invited to "${safeName}" on Aeon`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        <h2 style="color: #fff; margin: 0 0 8px;">Join &quot;${safeName}&quot;</h2>
        <p style="color: #94a3b8; margin: 0 0 24px; font-size: 14px;">
          ${safeInviter} invited you to collaborate on Aeon.
        </p>
        <a href="${safeUrl}" style="display: inline-block; padding: 12px 24px; background: #7c3aed; color: #fff; text-decoration: none; border-radius: 8px; font-size: 14px; font-weight: 500;">
          Accept Invite
        </a>
        <p style="color: #64748b; font-size: 12px; margin-top: 24px;">
          This invite expires in 7 days. If you didn't expect this, you can ignore it.
        </p>
      </div>
    `,
  })
}
