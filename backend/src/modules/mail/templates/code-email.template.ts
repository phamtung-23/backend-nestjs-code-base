import { MailMessage } from '../interfaces/mail-sender.interface';

export type CodeEmailKind = 'verification' | 'passwordReset' | 'login';

interface CodeEmailContent {
  subject: string;
  heading: string;
  intro: string;
  ignoreNote: string;
  accent: string;
}

const CONTENT: Record<CodeEmailKind, CodeEmailContent> = {
  verification: {
    subject: 'Verify your email address',
    heading: 'Welcome!',
    intro:
      'Thank you for registering. Please verify your email address using the code below:',
    ignoreNote: "If you didn't create an account, please ignore this email.",
    accent: '#28a745',
  },
  passwordReset: {
    subject: 'Reset your password',
    heading: 'Password reset request',
    intro:
      'You requested a password reset. Use the code below to reset your password:',
    ignoreNote:
      "If you didn't request a password reset, please ignore this email.",
    accent: '#dc3545',
  },
  login: {
    subject: 'Your login code',
    heading: 'Your login code',
    intro: 'Use the following code to log in:',
    ignoreNote: "If you didn't request this code, please ignore this email.",
    accent: '#007bff',
  },
};

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);

// Emails carrying a one-time code. Plain template functions keep markup out of
// MailService; move to a template engine (MJML, react-email, ...) when a
// project needs richer emails.
export function codeEmail(
  kind: CodeEmailKind,
  code: string,
  expiresInMinutes: number,
): Omit<MailMessage, 'to'> {
  const content = CONTENT[kind];
  const expiry = `This code will expire in ${expiresInMinutes} minutes.`;
  const safeCode = escapeHtml(code);

  return {
    subject: content.subject,
    text: [content.intro, '', code, '', expiry, content.ignoreNote].join('\n'),
    html: `
<div style="max-width: 600px; margin: 0 auto; padding: 20px; font-family: Arial, sans-serif;">
  <h2 style="color: #333; text-align: center;">${escapeHtml(content.heading)}</h2>
  <p style="color: #666; font-size: 16px;">${escapeHtml(content.intro)}</p>
  <div style="text-align: center; margin: 30px 0;">
    <div style="background-color: #f8f9fa; border: 2px solid ${content.accent}; padding: 20px; border-radius: 10px; display: inline-block;">
      <span style="font-size: 32px; font-weight: bold; color: ${content.accent}; letter-spacing: 10px;">${safeCode}</span>
    </div>
  </div>
  <p style="color: #666; font-size: 14px;">${escapeHtml(expiry)}</p>
  <p style="color: #666; font-size: 14px;">${escapeHtml(content.ignoreNote)}</p>
</div>`.trim(),
  };
}
