jest.mock('redis', () => require('redis-mock'));

import deduplicate from './deduplication';

it('returns true and then false for a key', async () => {
  expect(await deduplicate('foo')).toEqual(true);
  expect(await deduplicate('foo')).toEqual(false);
});

it('returns true for different keys', async () => {
  expect(await deduplicate('test1')).toEqual(true);
  expect(await deduplicate('test2')).toEqual(true);
});
