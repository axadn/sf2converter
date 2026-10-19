import { describe, it, test } from "node:test";
import { generateNonOverlappingRanges, getRangeSlices, assignSamplesToMatrixCells, generateSuggestedSamplerIndices, SampleJob, sampleMatrixAt, ResampleZones } from "../index";
import { GeneratorType, InstrumentZone, Range, SampleType } from "soundfont2";
import { createMockSample } from "./helpers/mockSample";
import { createMockInstrumentZone } from "./helpers/mockInstrumentZone";
import { createMockOutputZone } from "./helpers/mockOutputZone";
import { prepareSamplesForMix, renderSample } from "../sampleRenderer";

import * as assert from "node:assert";

describe('range slice generator', () => {
  it('creates velocity and note slices from zone boundaries', () => {
    const zones: InstrumentZone[] = [
      createMockInstrumentZone(
        { lo: 10, hi: 20 },
        createMockSample({}),
        {
          [GeneratorType.VelRange]: {
            range: { lo: 5, hi: 10 },
            id: GeneratorType.VelRange
          }
        }
      ),
      createMockInstrumentZone(
        { lo: 30, hi: 40 },
        createMockSample({}),
        {
          [GeneratorType.VelRange]: {
            range: { lo: 20, hi: 30 },
            id: GeneratorType.VelRange
          }
        }
      )
    ];

    const ranges = getRangeSlices(zones);

    assert.deepStrictEqual(ranges.velocityRanges, [
      { lo: 5, hi: 10 },
      { lo: 11, hi: 19 },
      { lo: 20, hi: 30 }
    ]);
    assert.deepStrictEqual(ranges.noteRanges, [
      { lo: 10, hi: 20 },
      { lo: 21, hi: 29 },
      { lo: 30, hi: 40 }
    ]);
  });

  it('defaults missing key and velocity ranges to the full MIDI range', () => {
    const zone = createMockInstrumentZone(
      { lo: 0, hi: 127 },
      createMockSample({})
    );
    delete zone.generators[GeneratorType.KeyRange];

    const ranges = getRangeSlices([zone]);

    assert.deepStrictEqual(ranges.velocityRanges, [{ lo: 0, hi: 127 }]);
    assert.deepStrictEqual(ranges.noteRanges, [{ lo: 0, hi: 127 }]);
  });
});

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

describe('sample rendering', () => {
  it('renders mono-only and single-channel samples without dropping them', async () => {
    const mono = createMockSample({
      name: 'mono-sample',
      type: SampleType.Mono,
      sampleRate: 44100,
    }, new Int16Array(2048).fill(8000));

    const left = createMockSample({
      name: 'left-sample',
      type: SampleType.Left,
      sampleRate: 44100,
    }, new Int16Array(1024).fill(12000));

    const right = createMockSample({
      name: 'right-sample',
      type: SampleType.Right,
      sampleRate: 44100,
    }, new Int16Array(1024).fill(-12000));

    const targetRange = { lo: 0, hi: 127 };
    const monoResult = await renderSample({
      header: mono.header, keyRange: targetRange, velRange: targetRange, mixDown: [mono]
    }, { bitrate: 128, quality: 5 });
    const leftResult = await renderSample({
      header: left.header, keyRange: targetRange, velRange: targetRange, mixDown: [left]
    }, { bitrate: 128, quality: 5 });
    const rightResult = await renderSample({
      header: right.header, keyRange: targetRange, velRange: targetRange, mixDown: [right]
    }, { bitrate: 128, quality: 5 });

    assert.ok(Buffer.isBuffer(monoResult.data));
    assert.ok(Buffer.isBuffer(leftResult.data));
    assert.ok(Buffer.isBuffer(rightResult.data));
    assert.ok(monoResult.data.length > 0);
    assert.ok(leftResult.data.length > 0);
    assert.ok(rightResult.data.length > 0);
    for (const result of [monoResult.data, leftResult.data, rightResult.data]) {
      assert.strictEqual(result[0], 0xff);
      assert.strictEqual(result[1] & 0xe0, 0xe0);
    }
  });

  it('transposes pitched samples to the root nearest the target range center', () => {
    const selected = createMockSample({
      originalPitch: 60,
      sampleRate: 44100
    }, new Int16Array([1, 2, 3]));
    const toTranspose = createMockSample({
      originalPitch: 72,
      sampleRate: 44100
    }, new Int16Array([0, 10, 20]));
    const unpitched = createMockSample({
      originalPitch: 255,
      sampleRate: 44100
    }, new Int16Array([5, 6, 7]));
    const prepared = prepareSamplesForMix({
      header: toTranspose.header,
      keyRange: { lo: 59, hi: 63 },
      velRange: { lo: 0, hi: 127 },
      mixDown: [toTranspose, selected, unpitched]
    });

    assert.strictEqual(prepared.header, selected.header);
    assert.deepStrictEqual(Array.from(prepared.mixDown[0].data), [0, 5, 10, 15, 20]);
    assert.strictEqual(prepared.mixDown[1], selected);
    assert.strictEqual(prepared.mixDown[2], unpitched);
  });
});

describe('sample lookup matrix generator', () => {
  it('prefers the first zone when overlapping samples collide', () => {
    const mainSample = createMockSample({ name: 'main' });
    const releaseSample = createMockSample({ name: 'release' });
    const zones = [
      createMockInstrumentZone({ lo: 104, hi: 106 }, mainSample, {
        [GeneratorType.VelRange]: { range: { lo: 97, hi: 104 }, id: GeneratorType.VelRange }
      }),
      createMockInstrumentZone({ lo: 106, hi: 106 }, releaseSample, {
        [GeneratorType.VelRange]: { range: { lo: 0, hi: 127 }, id: GeneratorType.VelRange }
      })
    ];
    const velocityRanges = [
      { lo: 0, hi: 96 },
      { lo: 97, hi: 104 },
      { lo: 105, hi: 127 }
    ];
    const keyRanges = [
      { lo: 0, hi: 103 },
      { lo: 104, hi: 106 },
      { lo: 107, hi: 127 }
    ];

    const result = assignSamplesToMatrixCells(velocityRanges, keyRanges, zones, 'first');

    assert.strictEqual(result.matrix[1][1]?.sampleKey, 'main');
    assert.deepStrictEqual(result.sampleJobs.get('main')?.mixDown, [mainSample]);
    assert.deepStrictEqual(result.zones.map(zone => zone.sampleKey).sort(), ['main', 'release']);
  });

  it('applies the configured policy when zones collide', () => {
    const firstSample = createMockSample({ name: 'first' });
    const lastSample = createMockSample({ name: 'last' });
    const zones = [
      createMockInstrumentZone({ lo: 0, hi: 127 }, firstSample),
      createMockInstrumentZone({ lo: 0, hi: 127 }, lastSample)
    ];
    const velocityRanges = [{ lo: 0, hi: 127 }];
    const keyRanges = [{ lo: 0, hi: 127 }];

    const firstResult = assignSamplesToMatrixCells(velocityRanges, keyRanges, zones, 'first');
    const lastResult = assignSamplesToMatrixCells(velocityRanges, keyRanges, zones, 'last');
    const mergeResult = assignSamplesToMatrixCells(velocityRanges, keyRanges, zones, 'merge');

    assert.strictEqual(firstResult.matrix[0][0]?.sampleKey, 'first');
    assert.deepStrictEqual(Array.from(firstResult.sampleJobs.keys()), ['first']);
    assert.deepStrictEqual(firstResult.zones.map(zone => zone.sampleKey), ['first']);
    assert.strictEqual(lastResult.matrix[0][0]?.sampleKey, 'last');
    assert.deepStrictEqual(Array.from(lastResult.sampleJobs.keys()), ['last']);
    assert.deepStrictEqual(lastResult.zones.map(zone => zone.sampleKey), ['last']);
    assert.deepStrictEqual(Array.from(mergeResult.sampleJobs.keys()), ['first']);
    assert.deepStrictEqual(mergeResult.zones.map(zone => zone.sampleKey), ['first']);
    assert.deepStrictEqual(mergeResult.sampleJobs.get('first')?.mixDown, [firstSample, lastSample]);
    assert.deepStrictEqual(mergeResult.sampleJobs.get('first')?.keyRange, { lo: 0, hi: 127 });
    assert.deepStrictEqual(mergeResult.sampleJobs.get('first')?.velRange, { lo: 0, hi: 127 });
  });

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

describe('zone resampler', () => {
  it('finds a zone in the matrix by key and velocity', () => {
    const first = createMockOutputZone({
      sampleKey: 'first',
      keyRange: { lo: 0, hi: 39 },
      velRange: { lo: 0, hi: 63 }
    });
    const matching = createMockOutputZone({
      sampleKey: 'matching',
      keyRange: { lo: 40, hi: 127 },
      velRange: { lo: 64, hi: 127 }
    });
    const matrix = [[first, undefined], [undefined, matching]];
    const keyRanges = [{ lo: 0, hi: 39 }, { lo: 40, hi: 127 }];
    const velocityRanges = [{ lo: 0, hi: 63 }, { lo: 64, hi: 127 }];

    assert.strictEqual(sampleMatrixAt(matrix, keyRanges, velocityRanges, 60, 100), matching);
    assert.strictEqual(sampleMatrixAt(matrix, keyRanges, velocityRanges, 60, 20), undefined);
  });

  it('samples source zones at each target cell center and removes unused sample jobs', () => {
    const lowerLeft = createMockOutputZone({
      id: 0,
      sampleKey: 'lower-left',
      keyRange: { lo: 0, hi: 40 },
      velRange: { lo: 0, hi: 63 }
    });
    const upperRight = createMockOutputZone({
      id: 1,
      sampleKey: 'upper-right',
      keyRange: { lo: 41, hi: 127 },
      velRange: { lo: 64, hi: 127 }
    });
    const unused = createMockOutputZone({
      id: 2,
      sampleKey: 'unused',
      keyRange: { lo: 0, hi: 63 },
      velRange: { lo: 64, hi: 127 }
    });
    const matrix = [
      [lowerLeft, undefined],
      [undefined, upperRight]
    ];
    const sampleJobs = new Map<string, SampleJob>(
      [lowerLeft, upperRight, unused].map(zone => {
        const sample = createMockSample({ name: zone.sampleKey });
        return [zone.sampleKey, {
          header: sample.header,
          keyRange: zone.keyRange,
          velRange: zone.velRange,
          mixDown: [sample]
        }];
      })
    );

    const fromKeyRanges = [{ lo: 0, hi: 40 }, { lo: 41, hi: 127 }];
    const fromVelocityRanges = [{ lo: 0, hi: 63 }, { lo: 64, hi: 127 }];
    const toKeyRanges = [{ lo: 0, hi: 63 }, { lo: 64, hi: 127 }];
    const toVelocityRanges = [{ lo: 0, hi: 63 }, { lo: 64, hi: 127 }];
    const result = ResampleZones(
      matrix,
      fromVelocityRanges,
      fromKeyRanges,
      toVelocityRanges,
      toKeyRanges,
      sampleJobs
    );

    assert.deepStrictEqual(result.matrix.map(row => row.map(zone => zone?.sampleKey)), [
      ['lower-left', undefined],
      [undefined, 'upper-right']
    ]);
    assert.deepStrictEqual(result.matrix[0][0]!.keyRange, { lo: 0, hi: 63 });
    assert.deepStrictEqual(result.matrix[1][1]!.velRange, { lo: 64, hi: 127 });
    assert.deepStrictEqual(result.zones.map(zone => zone.sampleKey), ['lower-left', 'upper-right']);
    assert.deepStrictEqual(Array.from(result.sampleJobs.keys()), ['lower-left', 'upper-right']);
    assert.strictEqual(matrix[0][0], lowerLeft);
  });

  it('uses the supplied target range dimensions and boundaries', () => {
    const source = createMockOutputZone({
      id: 0,
      sampleKey: 'source',
      keyRange: { lo: 0, hi: 127 },
      velRange: { lo: 0, hi: 127 }
    });
    const sample = createMockSample({ name: 'source' });
    const sampleJobs = new Map<string, SampleJob>([
      ['source', {
        header: sample.header,
        keyRange: source.keyRange,
        velRange: source.velRange,
        mixDown: [sample]
      }]
    ]);
    const fromKeyRanges = [{ lo: 0, hi: 127 }];
    const fromVelocityRanges = [{ lo: 0, hi: 127 }];
    const toKeyRanges = [{ lo: 10, hi: 19 }, { lo: 20, hi: 39 }];
    const toVelocityRanges = [{ lo: 40, hi: 49 }];

    const result = ResampleZones(
      [[source]],
      fromVelocityRanges,
      fromKeyRanges,
      toVelocityRanges,
      toKeyRanges,
      sampleJobs
    );

    assert.strictEqual(result.matrix.length, 2);
    assert.strictEqual(result.matrix[0].length, 1);
    assert.deepStrictEqual(result.matrix[0][0]!.keyRange, toKeyRanges[0]);
    assert.deepStrictEqual(result.matrix[1][0]!.keyRange, toKeyRanges[1]);
    assert.deepStrictEqual(result.matrix[0][0]!.velRange, toVelocityRanges[0]);
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
