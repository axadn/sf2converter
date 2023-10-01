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

type OutputZone = {
    id: number,
    sampleKey: string,
    keyRange: Range,
    velRange: Range,
    modulators?: ZoneMap<Modulator>,
    generators: ZoneMap<Generator>,
    suggestedSamplerIndex?: number
}

/* This matrix will aid in coming up with a schema of samplers to handle the different velocity layers,
 * as well as looking up which sample/sampler to route an incoming MIDI event to, 
 * given an arbitrarily irregular mapping. 
 * This is useful in cases where the key/velocity zones are not perfectly grid-like. For example,
 * consider the mapping below.
 *          
 *             _______ ____________ _____
 *            |       |    sample  |     |
 * y -        |       |____________|sample    Each sampler's job is to interpolate sample 
 * axis:    20|sample |  sample    |     |    pitch/timbre along x axis. (The current implementations
 *velocity    |       |____________|_____|    only allow 1 sample per note). 
 *          10|_______|        |         |    So we try to arrange them in layers like below
 *            |sample |sample  | sample  |    to batch as many samples as possible into each   
 *          0 |_______|________|_________|    sampler. This will minimize the number of instances needed.
 *             0   10   20   30   40   50 
 * 
 *                 x-axis: note number
 * 
              _______ ____________ _____     
 *            |       |    3       |     |  - Sampler3
 * y -        |       |____________|     |    
 * axis:    20|  3    |  2         | 2   |  - Sampler2 
 *velocity    |       |____________|_____|    
 *          10|_______|        |         |   
 *            |1      | 1      |  1      |   
 *          0 |_______|________|_________|  - Sampler1
 *             0   10   20   30   40   50 
 */
type SampleLookupMatrix = (OutputZone|undefined)[][];
interface SampleJob {
    header: SampleHeader;
    mixDown: Sample[];
};

/* velocityRages and keyRanges should be sorted in increasing order.*/
export function assignSamplesToMatrixCells(velocityRanges: Range[], keyRanges: Range[],
    zones: InstrumentZone[]): { matrix: SampleLookupMatrix, sampleJobs: Map<string, SampleJob> } {
    const matrix: SampleLookupMatrix = new Array(keyRanges.length);
    for(let i = 0; i <keyRanges.length; ++i){
        matrix[i] = new Array(velocityRanges.length);
    }
    const sampleJobs = new Map<string, SampleJob>();
    let outputZoneId = 0;
    zones.forEach(zone => {
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

        const outputZone: OutputZone = {
            id: outputZoneId++,
            keyRange,
            velRange,
            sampleKey: zone.sample.header.name,
            modulators: zone.modulators,
            generators: zone.generators
        };
        for (let i = keyBucket; i < keyBucket + numKeyBuckets; ++i) {
            for (let j = velBucket; j < velBucket + numVelocityBuckets; ++j) {
                if (matrix[i][j] && shouldAddToMixDown(zone.sample.header,
                    sampleJobs.get(matrix[i][j]!.sampleKey)!)
                ) {
                    sampleJobs.get(matrix[i][j]!.sampleKey)!.mixDown.push(zone.sample);
                }
                else if (!matrix[i][j]) {
                    matrix[i][j] = outputZone;
                    if (!sampleJobs.has(zone.sample.header.name)) {
                        sampleJobs.set(zone.sample.header.name,
                            { header: zone.sample.header, mixDown: [zone.sample] });
                    }
                }
            }
        }
    });
    return { matrix, sampleJobs };
}
function shouldAddToMixDown(newSample: SampleHeader, oldSample: SampleJob) {
    return areRightAndLeftSample(oldSample.header, newSample) &&
        oldSample.mixDown.length === 1;
}

function generateSuggestedSamplerIndicesPerZone(matrix: SampleLookupMatrix) {
    for (let i = 0; i < matrix.length; ++i) {
        let numEncountered = 0;
        let lastEncountered = null;
        for (let j = 0; j < matrix[i].length; ++j) {
            if(!matrix[i][j] || matrix[i][j] === lastEncountered) {
                continue;
            }
            if (typeof matrix[i][j]!.suggestedSamplerIndex === 'undefined') {
                matrix[i][j]!.suggestedSamplerIndex = numEncountered;
            }
            lastEncountered = matrix[i][j]?.id;
            ++numEncountered;
        }
    }
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