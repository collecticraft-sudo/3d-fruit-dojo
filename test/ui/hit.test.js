// Hit testing for menu targets (cut to select, hover, click).
import test from 'node:test';
import assert from 'node:assert/strict';
import { distPointSegment, pointInTarget, segmentHitsTarget, segmentParam } from '../../public/js/ui/hit.js';

const rect = { shape: 'rect', x: 500, y: 300, w: 400, h: 100 };
const circle = { shape: 'circle', x: 960, y: 540, r: 170 };

test('point in target: rectangles are centre-based, circles include their border', () => {
  assert.equal(pointInTarget(rect, 500, 300), true);
  assert.equal(pointInTarget(rect, 700, 350), true);
  assert.equal(pointInTarget(rect, 701, 300), false);
  assert.equal(pointInTarget(rect, 500, 351), false);
  assert.equal(pointInTarget(circle, 960 + 170, 540), true);
  assert.equal(pointInTarget(circle, 960 + 171, 540), false);
  assert.equal(pointInTarget(circle, 960 + 120, 540 + 120), true);
  assert.equal(pointInTarget(circle, 960 + 125, 540 + 125), false);
});

test('distance from a point to a segment', () => {
  assert.equal(distPointSegment(5, 5, 0, 0, 10, 0), 5);
  assert.equal(distPointSegment(-3, 4, 0, 0, 10, 0), 5, 'clamped to the start point');
  assert.equal(distPointSegment(13, 4, 0, 0, 10, 0), 5, 'clamped to the end point');
  assert.equal(distPointSegment(3, 4, 0, 0, 0, 0), 5, 'degenerate segment');
});

test('a blade segment crosses a rectangle when it passes through, ends inside, starts inside or grazes an edge', () => {
  assert.equal(segmentHitsTarget(rect, 200, 300, 800, 300), true, 'through');
  assert.equal(segmentHitsTarget(rect, 200, 300, 400, 300), true, 'ends inside');
  assert.equal(segmentHitsTarget(rect, 500, 300, 900, 900), true, 'starts inside');
  assert.equal(segmentHitsTarget(rect, 300, 260, 700, 340), true, 'diagonal');
  assert.equal(segmentHitsTarget(rect, 200, 100, 800, 100), false, 'above');
  assert.equal(segmentHitsTarget(rect, 100, 300, 250, 300), false, 'stops short');
  assert.equal(segmentHitsTarget(rect, 300, 249, 700, 249), false, 'just above the edge');
  assert.equal(segmentHitsTarget(rect, 300, 250, 700, 250), true, 'touching the edge counts');
  assert.equal(segmentHitsTarget(rect, 500, 100, 500, 900), true, 'vertical through');
  assert.equal(segmentHitsTarget(rect, 100, 100, 100, 900), false, 'vertical miss');
});

test('a blade segment crosses a circle by its distance to the centre (any length, no tunnelling)', () => {
  assert.equal(segmentHitsTarget(circle, 0, 540, 1920, 540), true);
  assert.equal(segmentHitsTarget(circle, 0, 540 - 170, 1920, 540 - 170), true, 'tangent');
  assert.equal(segmentHitsTarget(circle, 0, 540 - 171, 1920, 540 - 171), false);
  assert.equal(segmentHitsTarget(circle, 0, 0, 100, 100), false);
  assert.equal(segmentHitsTarget(circle, 900, 500, 901, 501), true, 'tiny segment inside');
});

test('segmentParam orders targets along the swing (first met = smallest parameter)', () => {
  const a = { shape: 'circle', x: 300, y: 500, r: 100 };
  const b = { shape: 'circle', x: 900, y: 500, r: 100 };
  assert.ok(segmentParam(a, 0, 500, 1200, 500) < segmentParam(b, 0, 500, 1200, 500));
  assert.ok(segmentParam(a, 1200, 500, 0, 500) > segmentParam(b, 1200, 500, 0, 500), 'reversed swing: b is met first');
  assert.equal(segmentParam(a, 1000, 0, 1000, 0), 0, 'degenerate segment');
  assert.equal(segmentParam(a, 500, 500, 700, 500), 0, 'clamped before the start');
  assert.equal(segmentParam(b, 0, 500, 200, 500), 1, 'clamped after the end');
});
