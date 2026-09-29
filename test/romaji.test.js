import test from 'node:test';
import assert from 'node:assert/strict';
import { foldLatin, kanaToRomaji, romajiVariants } from '../src/romaji.js';

test('kanaToRomaji handles yoon, sokuon, long vowels, and loanword spellings', () => {
  assert.equal(kanaToRomaji('アンビバレンス'), 'anbibarensu');
  assert.equal(kanaToRomaji('チュルリラ・チュルリラ・ダッダッダ！'), 'chururira chururira daddadda');
  assert.equal(kanaToRomaji('テレキャスタービーボーイ'), 'terekyasutaabiibooi');
  assert.equal(kanaToRomaji('ヴァンパイア'), 'vanpaia');
  assert.equal(kanaToRomaji('ラブリー☆えんじぇる!!'), 'raburii enjeru');
  assert.equal(kanaToRomaji('マッチ'), 'matchi');
});

test('kanaToRomaji refuses kanji and kana-free titles', () => {
  assert.equal(kanaToRomaji('ウミユリ海底譚'), null);
  assert.equal(kanaToRomaji('KING'), null);
});

test('romajiVariants adds a casual form without long vowels', () => {
  assert.deepEqual(romajiVariants('クローバー'), ['kuroobaa', 'kuroba']);
  assert.deepEqual(romajiVariants('キスキツネ'), ['kisukitsune']);
});

test('foldLatin folds stylized letters and drops symbols', () => {
  assert.equal(foldLatin('RONDØ'), 'rondo');
  assert.equal(foldLatin('Star☆Glitter'), 'star glitter');
  assert.equal(foldLatin('Café'), 'cafe');
  assert.equal(foldLatin('D✪N’T'), 'd nt');
});
