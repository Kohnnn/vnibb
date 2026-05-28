import { parseForeignTradingSnapshotTime } from './ForeignTradingWidget';

describe('parseForeignTradingSnapshotTime', () => {
  it('treats date-only foreign trading rows as 17:00 ICT settlement snapshots', () => {
    expect(parseForeignTradingSnapshotTime('2026-05-28')?.toISOString()).toBe('2026-05-28T10:00:00.000Z');
  });

  it('preserves explicit timestamps', () => {
    expect(parseForeignTradingSnapshotTime('2026-05-28T17:00:00+07:00')?.toISOString()).toBe('2026-05-28T10:00:00.000Z');
  });
});
