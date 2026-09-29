// Kana → Hepburn romaji and Latin folding used to generate searchable song aliases.
// Kanji has no reading without a dictionary, so titles containing it return null here
// and rely on the curated alias file instead.

const KANA = {
  あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o',
  か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko',
  が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go',
  さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so',
  ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo',
  た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to',
  だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do',
  な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no',
  は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho',
  ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo',
  ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po',
  ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo',
  や: 'ya', ゆ: 'yu', よ: 'yo',
  ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro',
  わ: 'wa', ゐ: 'i', ゑ: 'e', を: 'o', ん: 'n', ゔ: 'vu',
  ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o', ゃ: 'ya', ゅ: 'yu', ょ: 'yo', ゎ: 'wa'
};

// Two-kana combinations (yōon and katakana loanword spellings), checked before single kana.
const DIGRAPHS = {
  きゃ: 'kya', きゅ: 'kyu', きょ: 'kyo', ぎゃ: 'gya', ぎゅ: 'gyu', ぎょ: 'gyo',
  しゃ: 'sha', しゅ: 'shu', しょ: 'sho', しぇ: 'she', じゃ: 'ja', じゅ: 'ju', じょ: 'jo', じぇ: 'je',
  ちゃ: 'cha', ちゅ: 'chu', ちょ: 'cho', ちぇ: 'che', ぢゃ: 'ja', ぢゅ: 'ju', ぢょ: 'jo',
  にゃ: 'nya', にゅ: 'nyu', にょ: 'nyo', ひゃ: 'hya', ひゅ: 'hyu', ひょ: 'hyo',
  びゃ: 'bya', びゅ: 'byu', びょ: 'byo', ぴゃ: 'pya', ぴゅ: 'pyu', ぴょ: 'pyo',
  みゃ: 'mya', みゅ: 'myu', みょ: 'myo', りゃ: 'rya', りゅ: 'ryu', りょ: 'ryo',
  てぃ: 'ti', でぃ: 'di', とぅ: 'tu', どぅ: 'du', でゅ: 'dyu', てゅ: 'tyu',
  ふぁ: 'fa', ふぃ: 'fi', ふぇ: 'fe', ふぉ: 'fo', ふゅ: 'fyu',
  うぃ: 'wi', うぇ: 'we', うぉ: 'wo', ゔぁ: 'va', ゔぃ: 'vi', ゔぇ: 've', ゔぉ: 'vo',
  つぁ: 'tsa', つぃ: 'tsi', つぇ: 'tse', つぉ: 'tso', いぇ: 'ye'
};

const SMALL_TSU = 'っ';
const LONG_MARKS = new Set(['ー', '〜', '～']);

function katakanaToHiragana(text) {
  return text.replace(/[ァ-ヶ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60));
}

export function hasKanji(value) {
  return /[㐀-䶿一-鿿豈-﫿々〆]/.test(String(value || ''));
}

export function hasKana(value) {
  return /[ぁ-ゖァ-ヺ]/.test(String(value || ''));
}

// Romanizes kana; ASCII passes through, other symbols become word breaks.
// Returns null when the text contains kanji (no reliable reading) or no kana at all.
export function kanaToRomaji(value) {
  const input = String(value || '').normalize('NFKC');
  if (!hasKana(input) || hasKanji(input)) {
    return null;
  }

  const text = katakanaToHiragana(input);
  let output = '';
  let geminate = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const pair = text.slice(index, index + 2);

    if (char === SMALL_TSU) {
      geminate = true;
      continue;
    }

    if (LONG_MARKS.has(char)) {
      const lastVowel = output.match(/[aeiou]$/);
      output += lastVowel ? lastVowel[0] : ' ';
      continue;
    }

    let romaji = DIGRAPHS[pair];
    if (romaji) {
      index += 1;
    } else {
      romaji = KANA[char];
    }

    if (romaji) {
      if (geminate) {
        output += romaji.startsWith('ch') ? 't' : romaji[0];
        geminate = false;
      }
      output += romaji;
      continue;
    }

    geminate = false;
    output += /[a-z0-9]/i.test(char) ? char : ' ';
  }

  return output.toLowerCase().replace(/\s+/g, ' ').trim() || null;
}

// Strict romaji keeps long vowels from ー ("terekyasutaa"); casual typing usually drops them.
export function romajiVariants(value) {
  const strict = kanaToRomaji(value);
  if (!strict) {
    return [];
  }
  const casual = strict.replace(/([aeiou])\1+/g, '$1');
  return casual === strict ? [strict] : [strict, casual];
}

const LETTER_FOLDS = {
  ø: 'o', æ: 'ae', œ: 'oe', ß: 'ss', đ: 'd', ð: 'd', ł: 'l', þ: 'th', ı: 'i', ħ: 'h', ŧ: 't'
};

// Folds accented/stylized Latin letters to ASCII and turns every other symbol into a space,
// e.g. "RONDØ" → "rondo", "Star☆Glitter" → "star glitter".
export function foldLatin(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[øæœßđðłþıħŧ]/g, (char) => LETTER_FOLDS[char])
    .replace(/['’‘`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
