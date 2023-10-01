import * as fs from 'fs';
import * as path from 'path';
import bs from 'binary-search';
import {
    SoundFont2, Instrument, GeneratorType, Range, Sample,
    SampleHeader, ZoneMap, Modulator, Generator, SampleType, Zone, InstrumentZone
} from 'soundfont2';

// Do not specify any encoding type
const buffer = fs.readFileSync(path.resolve('./dark chat_3.sf2'));
const soundFont = new SoundFont2(buffer);
//https://www.npmjs.com/package/sample-player

/* Known restrictions/limitations : 
 * 1. Only one sample is allowed per zone. If a left and a right channel are 
 *    detected on the same zone they will be mixed down into a single sample.
 * 2. Explicit zones will not work with the web-based samplers we are targeting.
 *    Root notes will be used to define new zones.
 */

type OutputZone = { sampleKey: string, modulators: ZoneMap<Modulator>, generators: ZoneMap<Generator>; }
type SampleLookupMatrix = OutputZone[][];
interface SampleJob {
    header: SampleHeader;
    mixDown: Sample[];
};

function assignSamplesToMatrixCells(velocityRanges: Range[], keyRanges: Range[],
    instruments: Instrument[]): { matrix: SampleLookupMatrix, sampleJobs: Map<string, SampleJob> } {
    const matrix: SampleLookupMatrix = [];
    const sampleJobs = new Map<string, SampleJob>();
    instruments.forEach(instr => {
        instr.zones.forEach(zone => {
            if (!isCompatibleSampleType(zone.sample)) {
                return;
            }
            const velRange = zone.generators[GeneratorType.VelRange]!.range!;
            const keyRange = zone.generators[GeneratorType.KeyRange]!.range!;
            const velBucket = bs(velocityRanges, velRange.lo, (a: Range, b: number) => a.lo - b);
            const keyBucket = bs(keyRanges, keyRange.lo, (a: Range, b: number) => a.lo - b);
            let numVelocityBuckets = 1;
            while (velocityRanges[velBucket + numVelocityBuckets - 1].hi < velRange.hi) {
                ++numVelocityBuckets;
            }
            let numKeyBuckets = 1;
            while (keyRanges[keyBucket + numKeyBuckets - 1].hi < keyRange.hi) {
                ++numKeyBuckets;
            }
            for (let i = keyBucket; i < keyBucket + numKeyBuckets; ++i) {
                for (let j = velBucket; j < velBucket + numVelocityBuckets; ++j) {
                    if (matrix[i][j] && areRightAndLeftSample(
                        sampleJobs.get(matrix[i][j].sampleKey)!.header, zone.sample.header)) {
                        sampleJobs.get(matrix[i][j].sampleKey)!.mixDown.push(zone.sample);
                    }
                    else {
                        matrix[i][j] = {
                            sampleKey: zone.sample.header.name,
                            modulators: zone.modulators,
                            generators: zone.generators
                        };
                        sampleJobs.set(zone.sample.header.name,
                            { header: zone.sample.header, mixDown: [zone.sample] });
                    }
                }
            }
        });
    });
    return { matrix, sampleJobs };
}

function isCompatibleSampleType(sample: Sample) {
    switch (sample.header.type) {
        case SampleType.Left:
            return true;
        case SampleType.Right:
            return true;
        case SampleType.Mono:
            return true;
        default:
            return false;
    }
}

function areRightAndLeftSample(sample1: SampleHeader, sample2: SampleHeader) {
    return sample1.type === SampleType.Left && sample2.type === SampleType.Right ||
        sample1.type === SampleType.Right && sample2.type === SampleType.Left;
}

function getVelocityRangeSlices(zones: InstrumentZone[]): { velocityRanges: Range[], noteRanges: Range[] } {
    // These are 'left' boundaries. The 'boundary line' sits between the number and the integer below it.
    const velocityBoundaries: Set<number> = new Set();
    const noteBoundaries: Set<number> = new Set();
    let minNoteValue = Number.MAX_SAFE_INTEGER;
    let maxNoteValue = Number.MAX_SAFE_INTEGER;
    zones.forEach(z => {
        velocityBoundaries.add(z.generators[GeneratorType.VelRange]!.range!.lo);
        velocityBoundaries.add(z.generators[GeneratorType.VelRange]!.range!.hi + 1);

        noteBoundaries.add(
            z.generators[GeneratorType.OverridingRootKey]?.value ?? z.sample.header.originalPitch);
        minNoteValue = Math.min(minNoteValue, z.generators[GeneratorType.KeyRange]!.range!.lo);
        maxNoteValue = Math.max(maxNoteValue, z.generators[GeneratorType.KeyRange]!.range!.hi + 1);
    });

    noteBoundaries.add(minNoteValue);
    noteBoundaries.add(maxNoteValue);

    return {
        velocityRanges: generateNonOverlappingRanges(velocityBoundaries),
        noteRanges: generateNonOverlappingRanges(noteBoundaries)
    };
}
// This generates ranges where the 'lo' and 'hi' are both inclusive.
export function generateNonOverlappingRanges(boundaryValues: Set<number>) {
    const valuesSorted = Array.from(boundaryValues).sort((a, b) => a - b);
    const processedRanges = [];
    for (let i = 0; i < valuesSorted.length - 1; ++i) {
        processedRanges.push({ lo: valuesSorted[i], hi: valuesSorted[i + 1] - 1 });
    }
    return processedRanges;
}