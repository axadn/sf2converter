import { describe, it, test } from "node:test";
import { generateNonOverlappingRanges, assignSamplesToMatrixCells, generateSuggestedSamplerIndices } from "../index";
import { GeneratorType, InstrumentZone, Range, SampleType } from "soundfont2";
import { createMockSample } from "./helpers/mockSample";
import { createMockInstrumentZone } from "./helpers/mockInstrumentZone";
import { createMockOutputZone } from "./helpers/mockOutputZone";

import * as assert from "node:assert";
describe('non overlapping range generator', function () {
  it('should generate correct non-overlapping ranges', function () {
    const testValues = new Set<number>(
      [-1, 0, -4, 5, 10, 3]
    );

    const generatedRanges = generateNonOverlappingRanges(testValues);
    // -4  - -1 - 0 - 3 - 5 - 10 //

    const expected =
      [
        { lo: -4, hi: -2 },
        { lo: -1, hi: -1 },
        { lo: 0, hi: 2 },
        { lo: 3, hi: 4 },
        { lo: 5, hi: 9 }];

    assert.strictEqual(generatedRanges.length, 5);
    for (let i = 0; i < expected.length; ++i) {
      assert.strictEqual(generatedRanges[i].lo, expected[i].lo);
      assert.strictEqual(generatedRanges[i].hi, expected[i].hi);
    }
  });

});

describe('sample lookup matrix generator', () => {
  it('should assign samples to the right cells', () => {
    const zones: InstrumentZone[] = [
      createMockInstrumentZone({ lo: 0, hi: 40 },
        createMockSample({ type: SampleType.Mono, name: 'quiet_left' }),
        {
          [GeneratorType.VelRange]: {
            range: { lo: 0, hi: 16 },
            id: GeneratorType.VelRange
          }
        }),
      createMockInstrumentZone({ lo: 41, hi: 50 },
        createMockSample({ type: SampleType.Mono, name: 'quiet_right' }),
        {
          [GeneratorType.VelRange]: {
            range: { lo: 0, hi: 16 },
            id: GeneratorType.VelRange
          }
        }),
      createMockInstrumentZone({ lo: 0, hi: 20 },
        createMockSample({ type: SampleType.Mono, name: 'loud_left' }),
        {
          [GeneratorType.VelRange]: {
            range: { lo: 17, hi: 40 },
            id: GeneratorType.VelRange
          }
        }),
      createMockInstrumentZone({ lo: 21, hi: 40 },
        createMockSample({ type: SampleType.Mono, name: 'loud_mid' }),
        {
          [GeneratorType.VelRange]: {
            range: { lo: 17, hi: 40 },
            id: GeneratorType.VelRange
          }
        }),
      createMockInstrumentZone({ lo: 41, hi: 45 },
        createMockSample({ type: SampleType.Mono, name: 'loud_right' }),
        {
          [GeneratorType.VelRange]: {
            range: { lo: 17, hi: 40 },
            id: GeneratorType.VelRange
          }
        }),
    ];
    const noteRanges: Range[] = [
      { lo: 0, hi: 20 },
      { lo: 21, hi: 40 },
      { lo: 41, hi: 45 },
      { lo: 46, hi: 50 }
    ];
    const velRanges: Range[] = [
      { lo: 0, hi: 16 },
      { lo: 17, hi: 18 },
      { lo: 19, hi: 40 }
    ];

    const output = assignSamplesToMatrixCells(velRanges, noteRanges, zones);

    assert.strictEqual(output.matrix[0][0]!.sampleKey, 'quiet_left');
    assert.strictEqual(output.matrix[1][0]!.sampleKey, 'quiet_left');
    assert.strictEqual(output.matrix[2][0]!.sampleKey, 'quiet_right');
    assert.strictEqual(output.matrix[3][0]!.sampleKey, 'quiet_right');
    assert.strictEqual(output.matrix[0][1]!.sampleKey, 'loud_left');
    assert.strictEqual(output.matrix[0][2]!.sampleKey, 'loud_left');
    assert.strictEqual(output.matrix[1][1]!.sampleKey, 'loud_mid');
    assert.strictEqual(output.matrix[1][2]!.sampleKey, 'loud_mid');
    assert.strictEqual(output.matrix[2][1]!.sampleKey, 'loud_right');
    assert.strictEqual(output.matrix[2][2]!.sampleKey, 'loud_right');
    assert.strictEqual(output.matrix[3][1], undefined);
    assert.strictEqual(output.matrix[3][2], undefined);
  });
});

describe('suggested sampler index generator', () => {
  it('asssigns sampler indices to all the zones', () => {
    const topZone = createMockOutputZone(
      {
        id: 0,
        velRange: { lo: 20, hi: 40 },
        keyRange: { lo: 0, hi: 50 }
      });
    const bottomLeft = createMockOutputZone(
      {
        id: 1,
        velRange: { lo: 0, hi: 19 },
        keyRange: { lo: 0, hi: 50 }
      });
    const bottomMid = createMockOutputZone(
      {
        id: 2,
        velRange: { lo: 0, hi: 19 },
        keyRange: { lo: 25, hi: 50 }
      });
    const right = createMockOutputZone(
      {
        id: 3,
        velRange: { lo: 0, hi: 40 },
        keyRange: { lo: 51, hi: 60}
      });
    const matrix = [
      [bottomLeft, topZone],
      [bottomMid, topZone],
      [right, right]
    ];

    generateSuggestedSamplerIndices(matrix);

    assert.notEqual(topZone.suggestedSamplerIndex, undefined);
    assert.notEqual(bottomLeft.suggestedSamplerIndex, undefined);
    assert.notEqual(bottomMid.suggestedSamplerIndex, undefined);
    assert.notEqual(right.suggestedSamplerIndex, undefined);

  });
  it('doesn\'t assign any zones with overlapping key ranges to the same sampler', () => {
    const topZone = createMockOutputZone(
      {
        id: 0,
        velRange: { lo: 20, hi: 40 },
        keyRange: { lo: 0, hi: 50 }
      });
    const bottomLeft = createMockOutputZone(
      {
        id: 1,
        velRange: { lo: 0, hi: 19 },
        keyRange: { lo: 0, hi: 50 }
      });
    const bottomMid = createMockOutputZone(
      {
        id: 2,
        velRange: { lo: 0, hi: 19 },
        keyRange: { lo: 25, hi: 50 }
      });
    const right = createMockOutputZone(
      {
        id: 3,
        velRange: { lo: 0, hi: 40 },
        keyRange: { lo: 51, hi: 60}
      });
    const matrix = [
      [bottomLeft, topZone],
      [bottomMid, topZone],
      [right, right]
    ];

    generateSuggestedSamplerIndices(matrix);

    assert.notEqual(topZone.suggestedSamplerIndex, bottomLeft);
    assert.notEqual(topZone.suggestedSamplerIndex, bottomMid);
  });
});
