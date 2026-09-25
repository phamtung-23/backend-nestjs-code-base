export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  // Plain-text alternative for clients that don't render HTML
  text: string;
}

// The transport port: business code depends on this, never on nodemailer or
// a provider SDK. Swap the implementation (SES, Postmark, ...) in MailModule.
export interface MailSender {
  send(message: MailMessage): Promise<void>;
}
