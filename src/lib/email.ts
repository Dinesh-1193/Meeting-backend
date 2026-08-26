import { Resend } from "resend";
import { env } from "../config/env";

let resend: Resend | null = null;

function getResend(): Resend | null {
  if (!env.RESEND_API_KEY) return null;
  if (!resend) resend = new Resend(env.RESEND_API_KEY);
  return resend;
}

export async function sendMeetingInvite(input: {
  to: string;
  meetingName: string;
  hostName: string;
  scheduledAt?: string | null;
  joinUrl: string;
  passcode?: string | null;
}): Promise<void> {
  const when = input.scheduledAt
    ? new Date(input.scheduledAt).toLocaleString(undefined, {
        dateStyle: "full",
        timeStyle: "short",
      })
    : "Starting soon (instant meeting)";

  const passcodeLine = input.passcode
    ? `<p><strong>Passcode:</strong> ${escapeHtml(input.passcode)}</p>`
    : "";

  const html = `
    <div style="font-family: system-ui, sans-serif; line-height: 1.5;">
      <h2>You're invited to ${escapeHtml(input.meetingName)}</h2>
      <p>${escapeHtml(input.hostName)} invited you to a MeetSpace meeting.</p>
      <p><strong>When:</strong> ${escapeHtml(when)}</p>
      ${passcodeLine}
      <p><a href="${escapeHtml(input.joinUrl)}">Join meeting</a></p>
    </div>
  `;

  const client = getResend();
  if (!client) {
    console.info("[email] RESEND_API_KEY unset — invite logged only", {
      to: input.to,
      meetingName: input.meetingName,
      joinUrl: input.joinUrl,
    });
    return;
  }

  const { error } = await client.emails.send({
    from: env.EMAIL_FROM,
    to: input.to,
    subject: `MeetSpace invite: ${input.meetingName}`,
    html,
  });

  if (error) {
    console.error("[email] Failed to send invite", error);
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
