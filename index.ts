import {
    SoundFont2, GeneratorType, Range, Sample, SF2Chunk,
    SampleHeader, ZoneMap, Modulator, Generator, SampleType, InstrumentZone,
    Instrument as BaseInstrument
} from 'soundfont2';
import { renderSample } from './sampleRenderer';
import type { AudioOptions } from './sampleRenderer';

export type Instrument = BaseInstrument & {
  globalZone?: InstrumentZone[];
};

export type OutputZone = {
    id: number,
    sampleKey: string,
    keyRange: Range,
    velRange: Range,
    modulators?: ZoneMap<Modulator>,
    generators: ZoneMap<Generator>,
    suggestedSamplerIndex?: number
}

export type OutputSample = {
    id: string;
    header: SampleHeader;
    dataStart: number;
    dataLength: number;
};

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
export type SampleLookupMatrix = (OutputZone | undefined)[][];
export interface SampleJob {
    header: SampleHeader;
    keyRange: Range;
    velRange: Range;
    mixDown: Sample[];
};

export function sampleMatrixAt(
    matrix: SampleLookupMatrix,
    keyRanges: Range[],
    velocityRanges: Range[],
    keyValue: number,
    velocityValue: number
): OutputZone | undefined {
    const keyIndex = keyRanges.findIndex(range => range.lo <= keyValue && keyValue <= range.hi);
    const velocityIndex = velocityRanges.findIndex(
        range => range.lo <= velocityValue && velocityValue <= range.hi
    );
    return keyIndex < 0 || velocityIndex < 0
        ? undefined
        : matrix[keyIndex]?.[velocityIndex];
}

function findRangeBucket(ranges: Range[], value: number): number {
    const exactIndex = ranges.findIndex(range => range.lo <= value && value <= range.hi);
    if (exactIndex >= 0) {
        return exactIndex;
    }

    const nextIndex = ranges.findIndex(range => range.lo > value);
    if (nextIndex === -1) {
        return ranges.length - 1;
    }
    return nextIndex === 0 ? 0 : nextIndex - 1;
}

export type InstrumentLayerDefinition = {
    zoneMatrix: SampleLookupMatrix;
    zones: OutputZone[];
    velocityRanges: Range[];
    noteRanges: Range[];
    generators: ZoneMap<Generator>;
    modulators: ZoneMap<Modulator>;
}
export type InstrumentDefinition = {
    samples: OutputSample[];
    instrumentLayers: InstrumentLayerDefinition[];
};

export type ZoneCollisionPolicy = 'merge' | 'first' | 'last';

export type ConvertSf2Options = {
    simplifyType?: 'none' | {
        keyResolution: number;
        velocityResolution: number;
    };
    audio?: AudioOptions;
    zoneCollisionPolicy?: ZoneCollisionPolicy;
};

export async function convertSf2(
    chunk: Uint8Array | SF2Chunk,
    options: ConvertSf2Options = {}
): Promise<{ instrument: InstrumentDefinition, audioData: Buffer }> {
    const soundFont = new SoundFont2(chunk);

    const sampleJobs = new Map<string, SampleJob>();
    const instruments: InstrumentLayerDefinition[] = [];
    soundFont.instruments.forEach((instrument: Instrument) => {
    const firstZone = instrument.zones[0];

        let globalGenerators : ZoneMap<Generator> = {};
        let globalModulators : ZoneMap<Modulator> = {};

        if(instrument.globalZone){
            globalGenerators = firstZone.generators;
            globalModulators = firstZone.modulators;
        }
        const inputZones = instrument.zones;
        const zoneCollisionPolicy = options.zoneCollisionPolicy ?? 'first';
        let { velocityRanges, noteRanges } = getRangeSlices(inputZones);
        let { matrix, zones, sampleJobs } = assignSamplesToMatrixCells(
            velocityRanges,
            noteRanges,
            inputZones,
            zoneCollisionPolicy,
            soundFont.samples
        );
        if (options.simplifyType && options.simplifyType !== 'none') {
            const toKeyRanges = createResolutionRanges(options.simplifyType.keyResolution);
            const toVelocityRanges = createResolutionRanges(options.simplifyType.velocityResolution);
            const resampled = ResampleZones(
                matrix,
                velocityRanges,
                noteRanges,
                toVelocityRanges,
                toKeyRanges,
                sampleJobs
            );
            let newSampleJobs;
            ({ matrix, zones, sampleJobs: newSampleJobs } = resampled);
            for (const [sampleId, job] of newSampleJobs.entries()) {
                sampleJobs.set(sampleId, job);
            }
            noteRanges = toKeyRanges;
            velocityRanges = toVelocityRanges;
        }
        generateSuggestedSamplerIndices(matrix);
        instruments.push({
            zoneMatrix: matrix,
            zones,
            velocityRanges,
            noteRanges,
            modulators: globalModulators,
            generators: globalGenerators
        });
    });


    const samples: OutputSample[] = [];

    let sampleStart = 0;
    let combinedOutputBuffer = Buffer.alloc(0);
    for (const [sampleKey, sampleJob] of sampleJobs) {
        const renderedSample = await renderSample(sampleJob, options.audio);
        samples.push({
            id: sampleKey,
            header: renderedSample.header,
            dataStart: sampleStart,
            dataLength: renderedSample.data.length
        });
        combinedOutputBuffer = Buffer.concat([combinedOutputBuffer, renderedSample.data]);
        sampleStart += renderedSample.data.length;
    }


    return {
        instrument: {
            instrumentLayers: instruments, samples
        },
        audioData: combinedOutputBuffer
    };
};

function createResolutionRanges(resolution: number): Range[] {
    if (!Number.isInteger(resolution) || resolution <= 0) {
        throw new RangeError('Key and velocity resolutions must be positive integers.');
    }

    const ranges: Range[] = [];
    for (let lo = 0; lo <= 127; lo += resolution) {
        ranges.push({ lo, hi: Math.min(lo + resolution - 1, 127) });
    }
    return ranges;
}

/* velocityRages and keyRanges should be sorted in increasing order.*/
export function assignSamplesToMatrixCells(
    velocityRanges: Range[],
    keyRanges: Range[],
    zones: InstrumentZone[],
    zoneCollisionPolicy: ZoneCollisionPolicy = 'merge',
    soundFontSamples: Sample[] = []
): { matrix: SampleLookupMatrix, zones: OutputZone[], sampleJobs: Map<string, SampleJob> } {
    const matrix: SampleLookupMatrix = new Array(keyRanges.length);
    const outputZones: OutputZone[] = [];
    for (let i = 0; i < keyRanges.length; ++i) {
        matrix[i] = new Array(velocityRanges.length);
    }
    const sampleJobs = new Map<string, SampleJob>();
    let outputZoneId = 0;
    zones.forEach(zone => {
        if (!isCompatibleSampleType(zone.sample)) {
            return;
        }
        const velRange = zone.generators[GeneratorType.VelRange]?.range ?? { lo: 0, hi: 127 };
        const keyRange = zone.generators[GeneratorType.KeyRange]?.range ?? { lo: 0, hi: 127 };
        const velBucket = findRangeBucket(velocityRanges, velRange.lo);
        const keyBucket = findRangeBucket(keyRanges, keyRange.lo);
        let numVelocityBuckets = 1;
        while (velocityRanges[velBucket + numVelocityBuckets - 1]?.hi < velRange.hi) {
            ++numVelocityBuckets;
        }
        let numKeyBuckets = 1;
        while (keyRanges[keyBucket + numKeyBuckets - 1]?.hi < keyRange.hi) {
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
        const linkedSample = getLinkedSample(zone.sample, soundFontSamples);
        const zoneSamples = linkedSample ? [zone.sample, linkedSample] : [zone.sample];
        for (let i = keyBucket; i < keyBucket + numKeyBuckets; ++i) {
            for (let j = velBucket; j < velBucket + numVelocityBuckets; ++j) {
                const existingZone = matrix[i][j];
                if (existingZone) {
                    if (zoneCollisionPolicy === 'first') {
                        continue;
                    }
                    if (zoneCollisionPolicy === 'last') {
                        matrix[i][j] = outputZone;
                        sampleJobs.set(zone.sample.header.name, {
                            header: zone.sample.header,
                            keyRange,
                            velRange,
                            mixDown: zoneSamples
                        });
                    } else {
                        const sampleJob = sampleJobs.get(existingZone.sampleKey)!;
                        for (const sample of zoneSamples) {
                            if (!sampleJob.mixDown.includes(sample)) {
                                sampleJob.mixDown.push(sample);
                            }
                        }
                    }
                } else {
                    matrix[i][j] = outputZone;
                    if (!sampleJobs.has(zone.sample.header.name)) {
                        sampleJobs.set(zone.sample.header.name,
                            { header: zone.sample.header, keyRange, velRange, mixDown: zoneSamples });
                    }
                }
            }
        }
    });

    const selectedZones = new Set(matrix.flatMap(row => row.filter(
        (zone): zone is OutputZone => zone !== undefined
    )));
    outputZones.push(...selectedZones);
    const selectedSampleKeys = new Set(outputZones.map(zone => zone.sampleKey));
    for (const sampleKey of sampleJobs.keys()) {
        if (!selectedSampleKeys.has(sampleKey)) {
            sampleJobs.delete(sampleKey);
        }
    }

    return { matrix, zones: outputZones, sampleJobs };
}

function getLinkedSample(sample: Sample, soundFontSamples: Sample[]): Sample | undefined {
    const linkedType = sample.header.type === SampleType.Left
        ? SampleType.Right
        : sample.header.type === SampleType.Right
            ? SampleType.Left
            : undefined;
    if (linkedType === undefined) {
        return undefined;
    }

    const linkedSample = soundFontSamples[sample.header.link];
    return linkedSample?.header.type === linkedType ? linkedSample : undefined;
}

export function ResampleZones(
    fromMatrix: SampleLookupMatrix,
    fromVelocityRanges: Range[],
    fromKeyRanges: Range[],
    toVelocityRanges: Range[],
    toKeyRanges: Range[],
    sampleJobs: Map<string, SampleJob>
): { matrix: SampleLookupMatrix, zones: OutputZone[], sampleJobs: Map<string, SampleJob> } {
    const resampledZones: OutputZone[] = [];
    const resampledMatrix: SampleLookupMatrix = [];

    for (const keyRange of toKeyRanges) {
        const row: (OutputZone | undefined)[] = [];

        for (const velRange of toVelocityRanges) {
            const keyCenter = Math.floor((keyRange.lo + keyRange.hi) / 2);
            const velocityCenter = Math.floor((velRange.lo + velRange.hi) / 2);
            const sourceZone = sampleMatrixAt(
                fromMatrix,
                fromKeyRanges,
                fromVelocityRanges,
                keyCenter,
                velocityCenter
            );

            if (!sourceZone) {
                row.push(undefined);
                continue;
            }

            const simplifiedZone: OutputZone = {
                ...sourceZone,
                id: resampledZones.length,
                keyRange: { ...keyRange },
                velRange: { ...velRange }
            };
            resampledZones.push(simplifiedZone);
            row.push(simplifiedZone);
        }
        resampledMatrix.push(row);
    }

    const usedSampleKeys = new Set(resampledZones.map(zone => zone.sampleKey));
    const resampledSampleJobs = new Map(
        Array.from(sampleJobs).filter(([sampleKey]) => usedSampleKeys.has(sampleKey))
    );

    return { matrix: resampledMatrix, zones: resampledZones, sampleJobs: resampledSampleJobs };
}

export function generateSuggestedSamplerIndices(matrix: SampleLookupMatrix) {
    for (let i = 0; i < matrix.length; ++i) {
        let numEncountered = 0;
        let lastEncountered = null;
        for (let j = 0; j < matrix[i].length; ++j) {
            if (!matrix[i][j] || matrix[i][j] === lastEncountered) {
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

export function getRangeSlices(zones: InstrumentZone[]): { velocityRanges: Range[], noteRanges: Range[] } {
    // These are 'left' boundaries. The 'boundary line' sits between the number and the integer below it.
    const velocityBoundaries: Set<number> = new Set();
    const noteBoundaries: Set<number> = new Set();
    let minNoteValue = Number.MAX_SAFE_INTEGER;
    let maxNoteValue = Number.MIN_SAFE_INTEGER;
    zones.forEach(z => {
        velocityBoundaries.add(z.generators[GeneratorType.VelRange]?.range?.lo ?? 0);
        velocityBoundaries.add((z.generators[GeneratorType.VelRange]?.range?.hi ?? 127) + 1);

        noteBoundaries.add(
            z.generators[GeneratorType.KeyRange]?.range?.lo ?? 0);
        noteBoundaries.add((z.generators[GeneratorType.KeyRange]?.range?.hi ?? 127) + 1);
        minNoteValue = Math.min(minNoteValue, z.generators[GeneratorType.KeyRange]?.range?.lo ?? 0);
        maxNoteValue = Math.max(maxNoteValue, (z.generators[GeneratorType.KeyRange]?.range?.hi ?? 127) + 1);
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
