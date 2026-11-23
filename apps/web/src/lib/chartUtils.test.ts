import { calculateOBV } from './chartUtils';

describe('calculateOBV', () => {
  it('counts measured zero as a valid step and preserves the measured OBV path', () => {
    expect(calculateOBV([
      { time: 1, close: 10, volume: 40 },
      { time: 2, close: 12, volume: 0 },
      { time: 3, close: 11, volume: 5 },
      { time: 4, close: 11, volume: 100 },
    ])).toEqual([
      { time: 1, value: 40 },
      { time: 2, value: 40 },
      { time: 3, value: 35 },
      { time: 4, value: 35 },
    ]);
  });

  it.each([null, undefined, Number.NaN, -1])('does not bridge a missing or invalid volume (%s)', (volume) => {
    expect(calculateOBV([
      { time: 1, close: 10, volume: 40 },
      { time: 2, close: 12, volume },
      { time: 3, close: 13, volume: 100 },
    ])).toBeNull();
  });
});
