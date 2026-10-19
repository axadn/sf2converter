import { Sample, SampleType } from "soundfont2";
import { Lame} from "node-lame";
type sfreq = 8 | 11.025 | 12 | 16 | 22.05 | 24 | 32 | 44.1 | 48;
export type AudioOptions = {
    bitrate?: 8 | 16 | 24 | 32 | 40 | 48 | 56 | 64 | 80 | 96 | 112 | 128 | 144 | 160 | 192 | 224 | 256 | 320;
    quality?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
};

export async function renderSample(samples: Sample[], options: AudioOptions = {}): Promise<Buffer> {
    const bitrate = options.bitrate ?? 128;
    const quality = options.quality ?? 0;
    const left = samples.find(sample => sample.header.type === SampleType.Left);
    const right = samples.find(sample => sample.header.type === SampleType.Right);
    let mono = samples.find(sample => sample.header.type === SampleType.Mono);
    if (!left || !right) {
        mono = left ?? right;
    }
    if (!left && !right && !mono) {
        throw ("No valid samples to render");
    }

    let encoder: Lame;
    
    if (left && right) {
        const freq = left?.header.sampleRate! / 1000 as sfreq;
        encoder = new Lame({
            mode: 'j', // joint stereo
            raw: true,
            bitwidth: 16,
            signed: true,
            sfreq: freq,
            quality,
            "little-endian": true,
            output: "buffer",
            bitrate,
        });
        const mergedStereo = new Uint16Array(Math.max(left.data.length, right.data.length) * 2);
        for(let i = 0; i <left.data.length && i < right.data.length; ++i){
            if(i < left.data.length){
                mergedStereo[i*2] = left.data[i];
            }
            else{
                mergedStereo[i*2] = 0;
            }
            if(i < right.data.length){
                mergedStereo[i * 2 + 1] = right.data[i];
            }
            else{
                mergedStereo[i * 2 + 1] = 0;
            }
        }
        encoder.setBuffer(Buffer.from(mergedStereo.buffer));
    }
    else{
        const freq = left?.header.sampleRate! / 1000 as sfreq;
        encoder = new Lame({
            mode: 'm', // mono
            raw: true,
            bitwidth: 16,
            signed: true,
            sfreq: freq,
            quality,
            "little-endian": true,
            output: "buffer",
            bitrate,
        });
        encoder.setBuffer(Buffer.from(mono!.data.buffer));
    } 

    await encoder.decode();
    return encoder.getBuffer();
}