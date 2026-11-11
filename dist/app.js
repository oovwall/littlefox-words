const $ = (selector) => document.querySelector(selector);
const view = $('#view');
const editor = $('#editor');
const form = $('#entry');
const fields = form.elements;
const key = 'word-blocks.entries.v1';
const levels = ['生疏', '有印象', '较熟悉', '已记住'];
const scopes = { all: '全部', day: '按天', month: '按月', year: '按年' };
const pad = (value) => String(value).padStart(2, '0');
const dateKey = (date) => [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join('-');
const ago = (days) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return dateKey(date);
};
const safe = (value = '') => String(value).replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[character]));
const samples = [
  ['serendipity', '意外发现美好事物的运气', '/ˌser.ənˈdɪp.ə.t̬i/', '/ˌser.ənˈdɪp.ə.ti/', 'It was pure serendipity that we met again in Lisbon.', '我们能在里斯本重逢，纯属意外的好运。', 1],
  ['resilient', '有韧性的；能恢复的', '/rɪˈzɪl.jənt/', '/rɪˈzɪl.jənt/', 'The resilient plants survived the long winter.', '这些耐寒的植物熬过了漫长的冬天。', 3],
  ['ephemeral', '短暂的；转瞬即逝的', '/ɪˈfem.ɚ.əl/', '/ɪˈfem.ər.əl/', 'The colors of the sunrise were ephemeral.', '日出的色彩转瞬即逝。', 0],
  ['eloquent', '雄辩的；表达流畅的', '/ˈel.ə.kwənt/', '/ˈel.ə.kwənt/', 'She gave an eloquent speech about courage.', '她发表了一场关于勇气的精彩演讲。', 2],
  ['wanderlust', '旅行的强烈愿望', '/ˈwɑːn.dɚ.lʌst/', '/ˈwɒn.də.lʌst/', 'The old maps filled her with wanderlust.', '那些旧地图唤起了她旅行的渴望。', 2],
  ['luminous', '发光的；明亮的', '/ˈluː.mə.nəs/', '/ˈluː.mɪ.nəs/', 'A luminous moon hung above the lake.', '一轮明月悬在湖上。', 3],
  ['intricate', '复杂精细的', '/ˈɪn.trə.kət/', '/ˈɪn.trɪ.kət/', 'The vase had an intricate pattern.', '花瓶上有复杂精细的图案。', 1],
  ['tranquil', '平静的；安宁的', '/ˈtræŋ.kwəl/', '/ˈtræŋ.kwɪl/', 'We spent a tranquil afternoon by the river.', '我们在河边度过了一个宁静的下午。', 3],
  ['nuance', '细微差别', '/ˈnuː.ɑːns/', '/ˈnjuː.ɑːns/', 'He noticed a subtle nuance in her voice.', '他注意到她语气中的细微变化。', 0],
  ['flourish', '茁壮成长；繁荣', '/ˈflɝː.ɪʃ/', '/ˈflʌr.ɪʃ/', 'These flowers flourish in warm weather.', '这些花在温暖的天气里长势很好。', 2],
  ['candid', '坦率的；直言不讳的', '/ˈkæn.dɪd/', '/ˈkæn.dɪd/', 'Thank you for your candid feedback.', '谢谢你坦率的反馈。', 1],
  ['whimsical', '异想天开的；俏皮的', '/ˈwɪm.zɪ.kəl/', '/ˈwɪm.zɪ.kəl/', 'The café had a whimsical mural.', '咖啡馆里有一幅俏皮的壁画。', 0]
].map(([word, meaning, us, ipa, example, translation, level], index) => ({
  id: 'sample-' + index, word, meaning, us, ipa, example, translation, level,
  added: ago(Math.floor(index / 4)), sample: true
}));

let words = [];
let storageIssue = '';
try {
  words = JSON.parse(localStorage.getItem(key) ?? '[]');
  if (!Array.isArray(words)) throw new Error('Invalid entries');
} catch {
  words = [];
  storageIssue = '无法读取本地词库，请检查浏览器存储设置。';
}
let scope = 'all';
let selectedDate = ago(0);
let query = '';
let chartScope = 'day';
let editing = null;
let lookupController;
let toastTimer;
let pdfDocuments = [];
let libraryError = '';
let libraryReady = false;
let importBusy = false;
let importStatus = '';
let importResults = [];
let formSession = 0;
let saving = false;
const pendingLookups = new Set();

const libraryLoad = Learning.documents().then((documents) => {
  pdfDocuments = documents;
}).catch((error) => {
  libraryError = error.message;
}).finally(() => {
  libraryReady = true;
  if (!editor.open) render();
});

function examplesFor(word) {
  const legacy = word.example ? [{ text: word.example, translation: word.translation, source: '我的例句' }] : [];
  return Learning.uniqueExamples([
    ...Learning.matchedExamples(word.word, pdfDocuments),
    ...legacy,
    ...(word.examples ?? [])
  ]);
}

function matchesFor(word) {
  return Learning.matchedExamples(word.word, pdfDocuments);
}

function toast(message) {
  $('#toast').textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#toast').textContent = ''; }, 3600);
}

function save(nextWords) {
  if (storageIssue) {
    toast(storageIssue);
    return false;
  }
  try {
    localStorage.setItem(key, JSON.stringify(nextWords));
    words = nextWords;
    return true;
  } catch {
    toast('保存失败，请检查浏览器存储设置或剩余空间。');
    return false;
  }
}

const mastered = () => words.filter((word) => word.level === 3).length;
const segments = (options, current, action) => `<div class="segments" role="group" aria-label="时间范围">${Object.entries(options).map(([value, label]) =>
  `<button data-${action}="${value}" aria-pressed="${value === current}">${label}</button>`).join('')}</div>`;

function wordList() {
  view.innerHTML = `
    <section class="hero">
      <div class="hero-art" aria-hidden="true"><span>A</span><span>b</span><span>c</span></div>
      <h1>我的单词本</h1>
      <p>按日期收录生词，用颜色标记熟悉度。</p>
      <div class="counts"><span>已收录 <b>${words.length}</b></span><span>已记住 <b>${mastered()}</b></span></div>
    </section>
    <section class="section">
      <div class="toolbar">
        ${segments(scopes, scope, 'scope')}
        <div class="filters"><div id="date-filter"></div><input class="search" type="search" aria-label="搜索单词或释义" placeholder="⌕  搜索单词或释义"></div>
      </div>
      <div class="subbar">
        <h2 id="list-title"></h2>
        <div class="legend" aria-label="熟悉度">${levels.map((level, index) => `<span><i class="level-${index}"></i>${level}</span>`).join('')}</div>
      </div>
      <div class="grid" id="grid"></div>
    </section>`;
  const search = $('.search');
  search.value = query;
  search.addEventListener('input', () => {
    query = search.value;
    showGrid();
  });
  showDateFilter();
  showGrid();
}

function showDateFilter() {
  const size = { day: 10, month: 7, year: 4 }[scope];
  const prefix = selectedDate.slice(0, size);
  const container = $('#date-filter');
  if (!size) {
    container.innerHTML = '';
    return;
  }
  const allDates = (words.length ? words : samples).map(({ added }) => added.slice(0, size));
  const dates = [...new Set([prefix, ago(0).slice(0, size), ...allDates])].sort().reverse();
  container.innerHTML = `<select class="date-filter" aria-label="选择录入日期">${dates.map((date) =>
    `<option ${date === prefix ? 'selected' : ''}>${safe(date)}</option>`).join('')}</select>`;
  container.firstElementChild.addEventListener('change', (event) => {
    selectedDate = event.target.value.padEnd(10, '-01'.repeat(3));
    showGrid();
  });
}

function showGrid() {
  const length = { all: 0, day: 10, month: 7, year: 4 }[scope];
  const prefix = selectedDate.slice(0, length);
  const term = query.trim().toLowerCase();
  const visible = (words.length ? words : samples).filter(({ word, meaning, added }) =>
    added.startsWith(prefix) && (word.toLowerCase().includes(term) || (meaning ?? '').toLowerCase().includes(term))
  ).sort((a, b) => b.added.localeCompare(a.added));
  $('#list-title').textContent = `${words.length ? (prefix || '所有单词') : '示例词块'} · ${visible.length}`;
  $('#grid').innerHTML = visible.length ? visible.map((entry) =>
    `<a class="word level-${entry.level}" href="#word/${encodeURIComponent(entry.id)}">
      <div><strong>${safe(entry.word)}</strong><p>${safe(entry.meaning || '待补充释义')}</p></div>
      <small>${safe(entry.added)} · ${levels[entry.level]}</small>
    </a>`).join('') : '<p class="empty">这个范围内没有匹配的单词。</p>';
}

function showWord(word) {
  const examples = examplesFor(word);
  const missing = [
    ...(!word.us ? ['美式音标'] : []),
    ...(!word.ipa ? ['国际音标'] : []),
    ...(!word.meaning ? ['中文释义'] : []),
    ...(!examples.length ? ['例句'] : [])
  ];
  view.innerHTML = `<article class="detail">
    <a class="back" href="#words">← 返回单词本</a>
    <div class="detail-head level-${word.level}">
      <small>${word.sample ? '示例词块 · ' : '录入于 '}${safe(word.added)}</small>
      <h1>${safe(word.word)}</h1><p class="definition">${safe(word.meaning || '中文释义待补充')}</p>
    </div>
    <section class="panel">
      <h2>音标与发音</h2>
      <div class="pronunciation">
        <div><small>美式音标</small><p>${safe(word.us || '待补充')}</p><button data-speak="us">▷ 美式发音</button></div>
        <div><small>国际音标（IPA）</small><p>${safe(word.ipa || '待补充')}</p><button data-speak="uk">▷ 英式发音</button></div>
      </div>
    </section>
    ${word.definitions?.length ? `<section class="panel"><h2>英文释义</h2>${word.definitions.map((definition) =>
      `<p><small class="muted">${safe(definition.partOfSpeech)}.</small> ${safe(definition.text)}</p>`).join('')}</section>` : ''}
    <section class="panel">
      <div class="toolbar"><h2>例句 <span class="muted">${examples.length}</span></h2><a class="text-link" href="#library">管理 PDF 例句库 →</a></div>
      ${examples.length ? examples.map((example, index) => `<div class="example">
        <div class="example-line"><p>${safe(example.text)}</p><button data-sentence="${index}" class="speaker" aria-label="朗读例句 ${index + 1}" title="朗读例句">🔊</button></div>
        ${example.translation ? `<p class="muted">${safe(example.translation)}</p>` : ''}
        <div class="example-source">${example.sources?.length ? example.sources.map((source) =>
          `<span>Little Fox · ${safe(source.name)} · 第 ${source.page} 页</span>`).join('') : safe(example.source || '我的例句')}</div>
      </div>`).join('') : `<p class="muted">${libraryReady ? '暂未找到例句，可以上传 Little Fox 单词 PDF 自动匹配。' : '正在读取 PDF 例句库…'}</p>`}
    </section>
    ${!word.sample && missing.length ? `<section class="panel toolbar"><p class="muted">待补充${safe(missing.join('、'))}。</p><button data-refresh>自动补充</button></section>` : ''}
    ${word.sample ? '' : `<section class="panel"><div class="toolbar"><h2>熟悉程度</h2><button data-edit>编辑单词</button></div>
      <div class="level-options" role="group" aria-label="设置熟悉度">${levels.map((label, index) =>
        `<button class="level-${index}" data-level="${index}" aria-pressed="${index === word.level}">${label}</button>`).join('')}</div>
    </section>`}
  </article>`;
}

function showLibrary() {
  const countsByPdf = new Map();
  let matched = 0;
  for (const word of words) {
    const ids = new Set(matchesFor(word).flatMap((example) => example.sources.map((source) => source.documentId)));
    if (ids.size) matched++;
    for (const id of ids) countsByPdf.set(id, (countsByPdf.get(id) ?? 0) + 1);
  }
  view.innerHTML = `<article class="library">
    <div class="toolbar"><div><h1>PDF 例句库</h1><p class="muted library-intro">上传 Little Fox 单词 PDF，自动把例句关联到单词。</p></div>
      <button class="primary" data-upload ${importBusy || !libraryReady || libraryError ? 'disabled' : ''}>＋ 上传 PDF</button></div>
    <div class="metrics library-metrics">
      <div class="metric">PDF 文件<strong>${pdfDocuments.length}</strong></div>
      <div class="metric">已匹配的生词<strong>${matched}</strong></div>
    </div>
    <p class="muted form-note">PDF 在本机解析并保存。支持多选，可提取文字的 PDF 会自动识别完整英文例句。</p>
    ${libraryError ? `<p class="error-message" role="alert">${safe(libraryError)}</p>` : ''}
    <p id="import-status" role="status">${safe(importStatus || (!libraryReady ? '正在读取例句库…' : ''))}</p>
    <div id="import-results">${importResults.map((result) =>
      `<p class="${result.ok ? 'success-message' : 'error-message'}">${safe(result.name)} · ${safe(result.message)}</p>`).join('')}</div>
    <div class="pdf-list">${pdfDocuments.length ? [...pdfDocuments].sort((a, b) => b.added.localeCompare(a.added)).map((pdf) => {
      const count = countsByPdf.get(pdf.id) ?? 0;
      return `<section class="panel pdf-card"><div class="pdf-icon" aria-hidden="true">PDF</div>
        <div class="pdf-info"><h2>${safe(pdf.name)}</h2><p class="muted">${pdf.pageCount} 页 · ${pdf.examples.length} 条例句 · 匹配 ${count} 个生词</p>
        <small class="muted">上传于 ${safe(pdf.added.slice(0, 10))}</small></div>
        <button data-open-pdf="${safe(pdf.id)}">查看 PDF</button></section>`;
    }).join('') : '<div class="empty">上传第一份 PDF，开始收集 Little Fox 例句。</div>'}</div>
  </article>`;
}

async function importPdfs(files) {
  if (importBusy || libraryError) return;
  importBusy = true;
  importResults = [];
  importStatus = '准备导入…';
  render();
  try {
    await libraryLoad;
    for (const file of files) {
      importStatus = '正在解析 ' + file.name;
      if (location.hash === '#library') showLibrary();
      try {
        if (!/\.pdf$/i.test(file.name)) throw new Error('请选择 PDF 文件。');
        const pdf = await Learning.parsePdf(file, (page, total) => {
          importStatus = `正在解析 ${file.name} · 第 ${page} / ${total} 页`;
          if (location.hash === '#library') $('#import-status').textContent = importStatus;
        });
        if (pdfDocuments.some((item) => item.id === pdf.id)) {
          importResults.push({ name: file.name, ok: true, message: '已在例句库中，已跳过重复文件' });
          continue;
        }
        await Learning.storeDocument(pdf);
        pdfDocuments = [...pdfDocuments, pdf];
        const count = words.filter((word) => matchesFor(word).some((example) =>
          example.sources.some((source) => source.documentId === pdf.id))).length;
        importResults.push({ name: file.name, ok: true, message: `已导入 ${pdf.examples.length} 条例句，匹配 ${count} 个生词` });
      } catch (error) {
        const message = error.name === 'PasswordException' ? 'PDF 有密码保护，请上传已解锁的文件。' : error.message;
        importResults.push({ name: file.name, ok: false, message });
      }
    }
  } finally {
    importBusy = false;
    importStatus = '导入完成，之后添加的生词也会自动匹配。';
    $('#pdf-files').value = '';
    render();
  }
}

function chartPeriods(mode) {
  const now = new Date();
  if (mode === 'day') return Array.from({ length: 7 }, (_, index) => ago(6 - index));
  if (mode === 'month') return Array.from({ length: 6 }, (_, index) =>
    dateKey(new Date(now.getFullYear(), now.getMonth() - 5 + index, 1)).slice(0, 7));
  const earliest = Math.min(now.getFullYear() - 4, ...words.map(({ added }) => Number(added.slice(0, 4))));
  return Array.from({ length: now.getFullYear() - earliest + 1 }, (_, index) => String(earliest + index));
}

function showStats() {
  const periods = chartPeriods(chartScope).map((period) => {
    const added = words.filter((word) => word.added.startsWith(period)).length;
    const learned = words.filter((word) => word.level === 3 && word.masteredOn?.startsWith(period)).length;
    return { period, added, learned };
  });
  const maximum = Math.max(1, ...periods.flatMap(({ added, learned }) => [added, learned]));
  const bar = (count, label, type = '') => `<div class="bar ${type}" style="width:${100 * count / maximum}%" aria-label="${label} ${count} 个">${count}</div>`;
  view.innerHTML = `<article class="stats"><h1>学习统计</h1>
    <div class="metrics"><div class="metric">录入总量<strong>${words.length}</strong></div>
    <div class="metric">已记住总量<strong>${mastered()}</strong></div></div>
    <section class="panel">
      <div class="toolbar"><h2>录入与记忆趋势</h2>${segments({ day: '近 7 天', month: '近 6 月', year: '按年' }, chartScope, 'chart')}</div>
      <p class="muted">记忆量按当前已记住单词最近一次标记为「已记住」的日期统计。</p>
      <div class="legend subbar"><span><i style="--tone:#d8c7f2"></i>录入</span><span><i style="--tone:#7959bd"></i>已记住</span></div>
      <div class="chart">${periods.map(({ period, added, learned }) => `<div class="chart-row">
        <span>${period}</span><div>${bar(added, '录入')}${bar(learned, '已记住', 'learned')}</div>
      </div>`).join('')}</div>
    </section></article>`;
}

function activeWord() {
  const id = location.hash.split('/')[1];
  return [...words, ...samples].find((word) => word.id === id);
}

function render() {
  const stats = location.hash === '#stats';
  const library = location.hash === '#library';
  const word = activeWord();
  for (const link of document.querySelectorAll('[data-page]')) {
    const active = link.dataset.page === (stats ? 'stats' : library ? 'library' : 'words');
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  $('#breadcrumb').textContent = stats ? '我的词库 / 学习统计' : library ? '我的词库 / PDF 例句库' : '我的词库 / 单词本' + (word ? ' / 单词详情' : '');
  if (stats) showStats();
  else if (library) showLibrary();
  else if (word) showWord(word);
  else wordList();
}

function openEditor(word = null) {
  lookupController?.abort();
  formSession++;
  saving = false;
  editing = word;
  form.reset();
  for (const field of ['word', 'meaning', 'us', 'ipa', 'example', 'translation']) {
    fields[field].value = word?.[field] ?? '';
  }
  fields.word.readOnly = Boolean(word);
  $('#manual-fields').hidden = !word;
  $('#manual-fields').open = Boolean(word);
  $('#auto-note').hidden = Boolean(word);
  $('#save-entry').disabled = false;
  $('#save-entry').textContent = '保存单词';
  $('#form-status').textContent = '';
  $('#editor-title').textContent = word ? '编辑单词' : '添加单词';
  editor.showModal();
  fields.word.focus();
}

function mergeLookup(word, data) {
  return {
    ...word,
    meaning: word.meaning || data.meaning,
    us: word.us || data.us,
    ipa: word.ipa || data.ipa,
    usAudio: data.usAudio || word.usAudio,
    ukAudio: data.ukAudio || word.ukAudio,
    definitions: data.definitions.length ? data.definitions : word.definitions,
    examples: Learning.uniqueExamples([...(word.examples ?? []), ...data.examples]),
    lookupMissing: data.lookupMissing
  };
}

async function refreshWord(word, button) {
  if (pendingLookups.has(word.id)) return;
  pendingLookups.add(word.id);
  button.disabled = true;
  button.textContent = '正在获取…';
  try {
    const data = await Learning.lookup(word.word, undefined, matchesFor(word).length > 0);
    const current = words.find((item) => item.id === word.id);
    if (!current) return;
    if (!save(words.map((item) => item.id === word.id ? mergeLookup(current, data) : item))) return;
    render();
    toast(data.lookupMissing.length ? '已补充查到的内容，部分数据暂时不可用。' : '已自动补充单词信息');
  } catch (error) {
    toast(error.message || '获取失败，请稍后重试。');
  } finally {
    pendingLookups.delete(word.id);
    if (button.isConnected) {
      button.disabled = false;
      button.textContent = '自动补充';
    }
  }
}

async function readAloud(text, accent, url, button, isSentence = false) {
  const label = button.textContent;
  button.textContent = '◌';
  button.disabled = true;
  try {
    await Learning.speak(text, accent, url, isSentence);
  } catch (error) {
    toast(error.message);
  } finally {
    button.textContent = label;
    button.disabled = false;
  }
}

$('#add').addEventListener('click', () => openEditor());
for (const button of ['#cancel', '#close']) $(button).addEventListener('click', () => editor.close());
editor.addEventListener('close', () => {
  formSession++;
  lookupController?.abort();
});
$('#pdf-files').addEventListener('change', (event) => {
  const files = [...event.target.files];
  if (files.length) importPdfs(files);
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (saving) return;
  const wordText = Learning.normalize(fields.word.value);
  if (!wordText || !/^[a-zA-Z][a-zA-Z'’ -]*$/.test(wordText)) {
    $('#form-status').textContent = '请输入英文单词或短语。';
    fields.word.focus();
    return;
  }
  if (words.some((word) => word.id !== editing?.id && Learning.termKey(word.word) === Learning.termKey(wordText))) {
    $('#form-status').textContent = '这个单词已在词库中。';
    return;
  }
  const session = formSession;
  const previous = editing && words.find((word) => word.id === editing.id);
  if (editing && !previous) {
    $('#form-status').textContent = '该单词已在其他页面发生变化，请重新打开。';
    return;
  }
  saving = true;
  $('#save-entry').disabled = true;
  let entry;
  try {
    if (previous) {
      entry = { ...previous };
      for (const field of ['meaning', 'us', 'ipa', 'example', 'translation']) {
        entry[field] = fields[field].value.trim();
      }
    } else {
      $('#form-status').textContent = '正在自动补充音标、中文释义和例句…';
      $('#save-entry').textContent = '正在补充…';
      fields.word.readOnly = true;
      const controller = new AbortController();
      lookupController = controller;
      // Preserve the date when the user submits, including a lookup crossing midnight.
      entry = { id: crypto.randomUUID(), word: wordText, added: ago(0), level: 0 };
      await libraryLoad;
      const data = await Learning.lookup(wordText, controller.signal, matchesFor(entry).length > 0);
      if (session !== formSession || !editor.open) return;
      entry = mergeLookup(entry, data);
    }
    if (session !== formSession || !editor.open) return;
    // Another open page may have added the same word while network lookup was running.
    if (words.some((word) => word.id !== entry.id && Learning.termKey(word.word) === Learning.termKey(entry.word))) {
      $('#form-status').textContent = '这个单词已在词库中。';
      return;
    }
    const next = previous ? words.map((word) => word.id === entry.id ? entry : word) : [entry, ...words];
    if (!save(next)) return;
    editor.close();
    location.hash = '#word/' + entry.id;
    render();
    toast(previous ? '已保存修改' : entry.lookupMissing.length
      ? '单词已保存，部分信息暂未查到，可在详情页重试。'
      : '已自动补充单词信息');
  } catch (error) {
    if (session === formSession && error.name !== 'AbortError') {
      $('#form-status').textContent = '获取失败，请重试。';
    }
  } finally {
    if (session === formSession) {
      saving = false;
      fields.word.readOnly = Boolean(editing);
      $('#save-entry').disabled = false;
      $('#save-entry').textContent = '保存单词';
    }
  }
});

view.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  const { scope: nextScope, chart, speak: accent, level } = button.dataset;
  if (button.hasAttribute('data-upload')) $('#pdf-files').click();
  if (button.dataset.openPdf) {
    const pdf = pdfDocuments.find((item) => item.id === button.dataset.openPdf);
    if (pdf?.file) {
      const url = URL.createObjectURL(pdf.file);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  }
  if (nextScope) {
    scope = nextScope;
    for (const item of view.querySelectorAll('[data-scope]')) item.setAttribute('aria-pressed', String(item === button));
    showDateFilter();
    showGrid();
  }
  if (chart) {
    chartScope = chart;
    showStats();
    view.querySelector('[aria-pressed="true"]').focus();
  }
  const word = activeWord();
  if (!word) return;
  if (accent) readAloud(word.word, accent, word[accent + 'Audio'], button);
  if (button.dataset.sentence !== undefined) {
    const example = examplesFor(word)[Number(button.dataset.sentence)];
    if (example) readAloud(example.text, 'us', undefined, button, true);
  }
  if (button.hasAttribute('data-refresh')) refreshWord(word, button);
  if (button.hasAttribute('data-edit')) openEditor(word);
  if (level !== undefined && word.level !== Number(level)) {
    const updated = { ...word, level: Number(level), masteredOn: level === '3' ? ago(0) : undefined };
    if (save(words.map((item) => item.id === word.id ? updated : item))) {
      showWord(updated);
      view.querySelector('[data-level][aria-pressed="true"]').focus();
    }
  }
});

window.addEventListener('hashchange', () => {
  Learning.stopSpeech();
  render();
  window.scrollTo(0, 0);
});
window.addEventListener('storage', (event) => {
  if (event.key !== key) return;
  try {
    const next = JSON.parse(event.newValue ?? '[]');
    if (Array.isArray(next)) {
      words = next;
      render();
    }
  } catch {
    toast('无法读取其他页面保存的词库。');
  }
});
render();
if (storageIssue) toast(storageIssue);
