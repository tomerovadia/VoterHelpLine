jest.mock('redis', () => require('redis-mock'));

import isFirstUseOfKey from './deduplication';

it('returns true and then false for a key', async () => {
  expect(await isFirstUseOfKey('foo')).toEqual(true);
  expect(await isFirstUseOfKey('foo')).toEqual(false);
});

it('returns true for different keys', async () => {
  expect(await isFirstUseOfKey('test1')).toEqual(true);
  expect(await isFirstUseOfKey('test2')).toEqual(true);
});
