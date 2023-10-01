import { SampleHeader, Sample, Range, InstrumentZone, Modulator, GeneratorType, Generator, ZoneMap, Zone } from "soundfont2";
import { createMockSample } from "./mockSample";
export function createMockInstrumentZone(keyRange: Range,
    sample?: Sample,
    generators?: ZoneMap<Generator>,
    modulators?: ZoneMap<Modulator>,
): InstrumentZone {

    return {
        keyRange: Object.assign({}, keyRange),
        modulators: modulators ?? {},
        generators: Object.assign(
            {
                [GeneratorType.KeyRange]:
                { id: GeneratorType.KeyRange, range: keyRange }
            }, generators ?? {}),
        sample: sample ?? createMockSample({})
    };
}