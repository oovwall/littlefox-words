const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = __dirname;
const read = (file) => fs.readFileSync(path.join(root, 'dist', file), 'utf8');
let html = read('index.html').replace(
  '<link rel="stylesheet" href="style.css">',
  () => '<style>\n' + read('style.css') + '\n</style>'
);
html = html.replace(' data-auth="required"', '').replace('  <base href="/">\n', '')
  .replace('  <script src="auth.js" defer></script>\n', '');
for (const file of ['learning.js', 'review.js', 'app.js']) {
  const source = read(file);
  new vm.Script(source, { filename: file });
  html = html.replace('  <script src="' + file + '" defer></script>\n', '');
  html = html.replace('</body>', () => '<script>\n' + source.replace(/<\/script/gi, '<\\/script') + '\n</script>\n</body>');
}
const embeddedPdf = [
  ['pdfjs-module', 'vendor/pdf.mjs'],
  ['pdfjs-worker', 'vendor/pdf.worker.mjs'],
  ['word-lexicon', 'vendor/lexicon.json.gz']
].map(([id, file]) => '<script type="application/octet-stream" id="' + id + '">' +
  fs.readFileSync(path.join(root, 'dist', file)).toString('base64') + '</script>').join('\n');
const licenses = ['LICENSE', 'ECDICT-LICENSE.txt', 'IPA-DICT-LICENSE.txt', 'WORDNET-LICENSE.txt']
  .map((file) => '--- ' + file + ' ---\n' + read('vendor/' + file)).join('\n');
html = html.replace('<body>', () => '<body>\n' + embeddedPdf + '\n<!-- Third-party licenses\n' + licenses + '\n-->');
fs.writeFileSync(path.join(root, '词块.html'), html);
console.log('已生成词块.html，PDF 解析器已内置。');
