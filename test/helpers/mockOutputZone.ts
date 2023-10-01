import { OutputZone } from "../..";
export function createMockOutputZone(options: Partial<OutputZone>): OutputZone {
    const zone =  {
        id: 0,
        sampleKey: '',
        keyRange: {lo: 0, hi: 127},
        velRange: {lo: 0, hi: 127},
        generators: {},
    };
    return Object.assign(zone, options);
}