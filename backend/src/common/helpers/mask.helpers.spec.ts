import { maskEmail, maskEmailsIn } from './mask.helpers';

describe('maskEmail', () => {
  it.each([
    ['john.doe@example.com', 'jo***@example.com'],
    ['jo@example.com', 'j***@example.com'],
    ['a@example.com', '***@example.com'],
    ['not-an-email', '***'],
    ['@example.com', '***'],
  ])('masks %s as %s', (email, masked) => {
    expect(maskEmail(email)).toBe(masked);
  });
});

describe('maskEmailsIn', () => {
  it('masks every address inside a text and leaves the rest alone', () => {
    expect(
      maskEmailsIn(
        'Error: 550 5.1.1 <jane.doe@example.com>: Recipient address rejected (from noreply@example.org)',
      ),
    ).toBe(
      'Error: 550 5.1.1 <ja***@example.com>: Recipient address rejected (from no***@example.org)',
    );
  });

  it('returns text without addresses unchanged', () => {
    expect(maskEmailsIn('connect ECONNREFUSED 127.0.0.1:587')).toBe(
      'connect ECONNREFUSED 127.0.0.1:587',
    );
  });
});
