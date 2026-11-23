import { scoreFlow } from './quantRegime'

test.each([null, Number.NaN, Infinity])('does not score an unavailable 20D observation (%s)', (currentDelta) => {
  expect(scoreFlow(currentDelta, [-20, 0, 20])).toBeNull()
})

test('scores measured zero as balanced and normalizes signed deltas against observed history', () => {
  const history = [null, Number.NaN, -20, 0, 15, Infinity]
  expect(scoreFlow(0, history)).toBe(50)
  expect(scoreFlow(10, history)).toBe(75)
  expect(scoreFlow(-10, history)).toBe(25)
  expect(scoreFlow(10, [null])).toBe(100)
})
