import { Sample, SampleType } from "soundfont2";
import { Lame} from "node-lame";
type sfreq = 8 | 11.025 | 12 | 16 | 22.05 | 24 | 32 | 44.1 | 48;
export type AudioOptions = {
    bitrate?: 8 | 16 | 24 | 32 | 40 | 48 | 56 | 64 | 80 | 96 | 112 | 128 | 144 | 160 | 192 | 224 | 256 | 320;
    quality?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
    stereo?: boolean;
};

export async function renderSample(samples: Sample[], options: AudioOptions = {}): Promise<Buffer> {
    const bitrate = options.bitrate ?? 128;
    const quality = options.quality ?? 0;
    const stereo = options.stereo ?? true;

    if (samples.length === 0) {
        throw new Error("No valid samples to render");
    }

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
    return encoder.getBuffer();
}

function clamp(value: number): number {
    return Math.max(-32768, Math.min(32767, value));
}