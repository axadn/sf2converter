import { SampleHeader, Sample, SampleType } from "soundfont2";
export function createMockSample(
    headerOptions: Partial<SampleHeader>, data?: Int16Array): Sample {
    const sample = {
        header: {
            name: 'string',
            start: 0,
            end: 0,
            startLoop: 0,
            endLoop: 0,
            sampleRate: 0,
            originalPitch: 0,
            pitchCorrection: 0,
            link: 0,
            type: SampleType.Mono,
        },
        data: data ?? new Int16Array(0)
    };
    sample.header = Object.assign(sample.header, headerOptions);
    return sample;
}