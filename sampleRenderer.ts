import { Sample, SampleType } from "soundfont2";
import type { SampleJob } from "./index";
import { Lame} from "node-lame";
type sfreq = 8 | 11.025 | 12 | 16 | 22.05 | 24 | 32 | 44.1 | 48;
export type AudioOptions = {
    bitrate?: 8 | 16 | 24 | 32 | 40 | 48 | 56 | 64 | 80 | 96 | 112 | 128 | 144 | 160 | 192 | 224 | 256 | 320;
    quality?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
    stereo?: boolean;
};

export function prepareSamplesForMix(job: SampleJob): Pick<SampleJob, "header" | "mixDown"> {
    const keyCenter = (job.keyRange.lo + job.keyRange.hi) / 2;
    const reference = job.mixDown
        .filter(sample => sample.header.originalPitch !== 255)
        .reduce<Sample | undefined>((closest, sample) => {
            if (!closest || Math.abs(sample.header.originalPitch - keyCenter) <
                Math.abs(closest.header.originalPitch - keyCenter)) {
                return sample;
            }
            return closest;
        }, undefined);

    if (!reference) {
        return { header: job.header, mixDown: job.mixDown };
    }

    const targetPitch = reference.header.originalPitch + reference.header.pitchCorrection / 100;
    const mixDown = job.mixDown.map(sample => {
        if (sample.header.originalPitch === 255) {
            return sample;
        }

        const samplePitch = sample.header.originalPitch + sample.header.pitchCorrection / 100;
        const sampleRateRatio = sample.header.sampleRate > 0 && reference.header.sampleRate > 0
            ? sample.header.sampleRate / reference.header.sampleRate
            : 1;
        const step = sampleRateRatio * 2 ** ((targetPitch - samplePitch) / 12);

        if (sample === reference || Math.abs(step - 1) < Number.EPSILON) {
            return sample;
        }

        const outputLength = Math.max(1, Math.floor((sample.data.length - 1) / step) + 1);
        const data = new Int16Array(outputLength);
        for (let i = 0; i < outputLength; ++i) {
            const sourcePosition = i * step;
            const sourceIndex = Math.floor(sourcePosition);
            const fraction = sourcePosition - sourceIndex;
            const first = sample.data[sourceIndex] ?? 0;
            const second = sample.data[sourceIndex + 1] ?? first;
            data[i] = Math.round(first + (second - first) * fraction);
        }
        return { header: sample.header, data };
    });

    return { header: reference.header, mixDown };
}

export async function renderSample(
    job: SampleJob,
    options: AudioOptions = {}
): Promise<{ data: Buffer, header: Sample["header"] }> {
    const bitrate = options.bitrate ?? 128;
    const quality = options.quality ?? 0;
    const stereo = options.stereo ?? true;

    if (job.mixDown.length === 0) {
        throw new Error("No valid samples to render");
    }

    const prepared = prepareSamplesForMix(job);
    const samples = prepared.mixDown;
    const maxLength = Math.max(...samples.map(sample => sample.data.length));
    const mixed = stereo ? new Int16Array(maxLength * 2) : new Int16Array(maxLength);

    for (const sample of samples) {
        const leftChannel = !stereo || sample.header.type === SampleType.Left || sample.header.type === SampleType.Mono;
        const rightChannel = !stereo ? false : sample.header.type === SampleType.Right || sample.header.type === SampleType.Mono;

        for (let i = 0; i < sample.data.length; ++i) {
            const sampleValue = sample.data[i];
            const index = i * 2;

            if (stereo) {
                if (leftChannel) {
                    mixed[index] = clamp(mixed[index] + sampleValue);
                }
                if (rightChannel) {
                    mixed[index + 1] = clamp(mixed[index + 1] + sampleValue);
                }
            } else {
                mixed[i] = clamp(mixed[i] + sampleValue);
            }
        }
    }

    const freq = (samples[0].header.sampleRate / 1000) as sfreq;
    const encoder = new Lame({
        mode: stereo ? 'j' : 'm',
        raw: true,
        bitwidth: 16,
        signed: true,
        sfreq: freq,
        quality,
        "little-endian": true,
        output: "buffer",
        bitrate,
    });
    encoder.setBuffer(Buffer.from(mixed.buffer, mixed.byteOffset, mixed.byteLength));

    await encoder.encode();
    return { data: encoder.getBuffer(), header: prepared.header };
}

function clamp(value: number): number {
    return Math.max(-32768, Math.min(32767, value));
}