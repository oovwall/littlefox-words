// Inputs: ECDICT CSV, ipa-dict en_US/en_UK TSV files, and WordNet 3.0's dict directory.
const fs = require('node:fs');
const path = require('node:path');
const { gzipSync } = require('node:zlib');
const [ecdict, american, british, wordnet] = process.argv.slice(2);
if (!wordnet) throw new Error('Usage: node build-lexicon.cjs <ecdict.csv> <en_US.txt> <en_UK.txt> <wordnet/dict>');

function pronunciations(file) {
  return new Map(fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => {
    const [word, ipa] = line.split('\t');
    return [word.toLowerCase(), ipa?.split(', /')[0] ?? ''];
  }));
}

const us = pronunciations(american);
const uk = pronunciations(british);
const wordnetExamples = new Map();
for (const type of ['noun', 'verb', 'adj', 'adv']) {
  for (const line of fs.readFileSync(path.join(wordnet, 'data.' + type), 'utf8').split('\n')) {
    if (!/^\d{8} /.test(line)) continue;
    const separator = line.indexOf(' | ');
    if (separator < 0) continue;
    const synset = line.slice(0, separator).split(' ');
    const count = Number.parseInt(synset[3], 16);
    const examples = [...line.slice(separator + 3).matchAll(/"([^"]+)"/g)].map((match) => match[1].trim())
      .filter((example) => example.length <= 240 && example.split(/\s+/).length >= 3);
    if (!examples.length) continue;
    for (let index = 0; index < count; index++) {
      const word = synset[4 + index * 2].replaceAll('_', ' ').toLowerCase();
      const pattern = new RegExp('(^|[^a-z])' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z])', 'i');
      const matched = examples.filter((example) => pattern.test(example));
      if (matched.length) {
        wordnetExamples.set(word, [...new Set([...(wordnetExamples.get(word) ?? []), ...matched])].slice(0, 4));
      }
    }
  }
}

function csvFields(line) {
  const pattern = /(?:^|,)(?:"((?:[^"]|"")*)"|([^,]*))/g;
  const fields = [];
  for (const match of line.matchAll(pattern)) {
    fields.push(match[1]?.replaceAll('""', '"') ?? match[2]);
  }
  return fields;
}

const lexicon = Object.create(null);
for (const line of fs.readFileSync(ecdict, 'utf8').split(/\r?\n/).slice(1)) {
  const [headword, phonetic, , translation, , , oxford, tag, bnc, frequency] = csvFields(line);
  const word = headword?.toLowerCase().trim();
  if (!word || !/^[a-z][a-z0-9' -]{0,59}$/.test(word) || !/[\u3400-\u9fff]/.test(translation ?? '')) continue;
  const ranked = [bnc, frequency].some((rank) => Number(rank) > 0 && Number(rank) <= 60000);
  if (!ranked && oxford !== '1' && !tag && !wordnetExamples.has(word) && !(us.has(word) && uk.has(word))) continue;
  const senses = translation.split('\\n').filter((sense) => sense.trim());
  const commonSenses = senses.filter((sense) => !sense.startsWith('[网络]'));
  const meaning = (commonSenses.length ? commonSenses : senses).slice(0, 4).join('\n');
  const fallback = phonetic ? '/' + phonetic.replace(/^\/|\/$/g, '') + '/' : '';
  const record = [meaning, us.get(word) || '', uk.get(word) || fallback, wordnetExamples.get(word) ?? []];
  if (!lexicon[word] || headword === word) lexicon[word] = record;
}

const result = gzipSync(JSON.stringify(lexicon), { level: 9 });
fs.writeFileSync(path.join(__dirname, 'dist', 'vendor', 'lexicon.json.gz'), result);
console.log(Object.keys(lexicon).length.toLocaleString(), 'entries;', result.length.toLocaleString(), 'bytes compressed');
