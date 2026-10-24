import * as fs from 'fs';
import * as path from 'path';
import { SoundFont2 } from 'soundfont2';
import { convertSf2 } from './index';

const buffer = fs.readFileSync(path.resolve('./STR_FULL_ENS.sf2'));
const soundFont = new SoundFont2(buffer);
console.log(`SoundFont has ${soundFont.instruments.length} instruments.`);

convertSf2(buffer, { simplifyType: { keyResolution: 10, velocityResolution: 30 } }).then(result => {
    const { instrument, audioData } = result;
    fs.writeFileSync(path.resolve('./output.mp3'), audioData);
    fs.writeFileSync(path.resolve('./output.json'), JSON.stringify(instrument, null, 2));
});
