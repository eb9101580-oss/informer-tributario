import test from 'node:test';
import assert from 'node:assert/strict';
import { isCurrentFeedItem, isPublishedWithinDays, publicationDateKey } from '../src/services/feedWindow.js';

const now = new Date('2026-08-19T15:00:00Z');

test('feed aceita hoje e ontem no calendario brasileiro', () => {
  assert.equal(isCurrentFeedItem({ publishedAt: '2026-08-19' }, now), true);
  assert.equal(isCurrentFeedItem({ publishedAt: '2026-08-18T08:30:00Z' }, now), true);
  assert.equal(isCurrentFeedItem({ publishedAt: '2026-08-17T23:59:59Z' }, now), false);
  assert.equal(isCurrentFeedItem({ publishedAt: '' }, now), false);
});

test('virada diaria remove anteontem e preserva ontem', () => {
  const august21 = new Date('2026-08-21T12:00:00-03:00');
  assert.equal(isCurrentFeedItem({ publishedAt: '2026-08-21T00:01:00-03:00' }, august21), true);
  assert.equal(isCurrentFeedItem({ publishedAt: '2026-08-20T00:01:00-03:00' }, august21), true);
  assert.equal(isCurrentFeedItem({ publishedAt: '2026-08-19T23:59:59-03:00' }, august21), false);
});

test('coleta preserva data desconhecida para confirmar no documento', () => {
  assert.equal(isPublishedWithinDays('', 2, now, { allowUnknown: true }), true);
  assert.equal(isPublishedWithinDays('2026-06-19', 2, now, { allowUnknown: true }), false);
  assert.equal(publicationDateKey('2026-08-18T00:00:00Z'), '2026-08-18');
});
