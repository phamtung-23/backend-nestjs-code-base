import { codeEmail } from './code-email.template';

describe('codeEmail', () => {
  it.each([
    ['verification', 'Verify your email address'],
    ['passwordReset', 'Reset your password'],
    ['login', 'Your login code'],
  ] as const)('builds the %s email', (kind, subject) => {
    const email = codeEmail(kind, '123456', 10);

    expect(email.subject).toBe(subject);
    expect(email.html).toContain('123456');
    expect(email.html).toContain('This code will expire in 10 minutes.');
    expect(email.text).toContain('123456');
    expect(email.text).toContain('This code will expire in 10 minutes.');
  });

  it('escapes interpolated values in the HTML', () => {
    const email = codeEmail('login', '<b>"1"&\'2\'</b>', 5);

    expect(email.html).toContain(
      '&lt;b&gt;&quot;1&quot;&amp;&#39;2&#39;&lt;/b&gt;',
    );
    expect(email.html).not.toContain('<b>"1"');
    expect(email.html).toContain('didn&#39;t request this code');
  });
});
