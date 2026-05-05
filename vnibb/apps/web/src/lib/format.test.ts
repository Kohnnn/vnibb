import { formatTimestamp, parseFlexibleDate } from '@/lib/format';

describe('format helpers', () => {
  test('parseFlexibleDate handles Vietnamese absolute timestamps', () => {
    const parsed = parseFlexibleDate('30/03/2026 21:44');
    expect(parsed).not.toBeNull();
    expect(parsed?.getFullYear()).toBe(2026);
    expect(parsed?.getMonth()).toBe(2);
    expect(parsed?.getDate()).toBe(30);
  });

  test('parseFlexibleDate handles Vietnamese relative timestamps', () => {
    const parsed = parseFlexibleDate('2 giờ trước');
    expect(parsed).not.toBeNull();
    expect(formatTimestamp(parsed)).not.toBe('-');
  });
});
