// For log lines: enough to tell addresses apart, not enough to harvest them.
// "john.doe@example.com" -> "jo***@example.com"
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) {
    return '***';
  }
  const local = email.slice(0, at);
  return `${local.slice(0, Math.min(2, local.length - 1))}***${email.slice(at)}`;
}

const EMAIL_IN_TEXT = /[^\s<>()"',;:@]+@[^\s<>()"',;:@]+\.[^\s<>()"',;:@]+/g;

// For third-party error messages and stacks that may echo addresses (e.g. an
// SMTP "550 <jane@example.com>: Recipient address rejected" reply)
export const maskEmailsIn = (text: string): string =>
  text.replace(EMAIL_IN_TEXT, (email) => maskEmail(email));
