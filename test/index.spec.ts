import { describe,it,test } from "node:test";
import { generateNonOverlappingRanges } from "../index";
import { Range } from "soundfont2";
import * as assert from "node:assert";
describe('non overlapping range generator', function () {
  it('should generate correct non-overlapping ranges', function () {
    const testValues = new Set<number>(
      [-1, 0, -4, 5, 10, 3]
    );

    const generatedRanges = generateNonOverlappingRanges(testValues);
      // -4  - -1 - 0 - 3 - 5 - 10 //

    const expected =
    [
      {lo: -4, hi: -2},
      {lo: -1, hi: -1},
      {lo: 0, hi: 2},
      {lo: 3, hi: 4},
      {lo: 5, hi: 9}];

    assert.strictEqual(generatedRanges.length, 5);
    for(let i = 0; i < expected.length; ++i){
      assert.strictEqual(generatedRanges[i].lo, expected[i].lo);
      assert.strictEqual(generatedRanges[i].hi, expected[i].hi);
    }
  });

});
