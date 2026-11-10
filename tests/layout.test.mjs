import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textFromTSV } from '../src/index.js';

test('joins visual labels and amounts across OCR blocks', () => {
  const header = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext';
  const tsv = [header,
    '5\t1\t1\t1\t1\t1\t20\t100\t70\t20\t90\tTOTAL',
    '5\t1\t2\t1\t1\t1\t350\t100\t80\t20\t85\t$18.90',
    '5\t1\t3\t1\t1\t1\t20\t160\t80\t20\t88\tTHANKS',
  ].join('\n');
  assert.equal(textFromTSV(tsv), 'TOTAL $18.90\nTHANKS');
});
