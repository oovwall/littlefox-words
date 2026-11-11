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
let lookupData = {};
let lookupController;
let sound;
let toastTimer;

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
    added.startsWith(prefix) && (word.toLowerCase().includes(term) || meaning.toLowerCase().includes(term))
  ).sort((a, b) => b.added.localeCompare(a.added));
  $('#list-title').textContent = `${words.length ? (prefix || '所有单词') : '示例词块'} · ${visible.length}`;
  $('#grid').innerHTML = visible.length ? visible.map((entry) =>
    `<a class="word level-${entry.level}" href="#word/${encodeURIComponent(entry.id)}">
      <div><strong>${safe(entry.word)}</strong><p>${safe(entry.meaning || '待补充释义')}</p></div>
      <small>${safe(entry.added)} · ${levels[entry.level]}</small>
    </a>`).join('') : '<p class="empty">这个范围内没有匹配的单词。</p>';
}

function showWord(word) {
  view.innerHTML = `<article class="detail">
    <a class="back" href="#words">← 返回单词本</a>
    <div class="detail-head level-${word.level}">
      <small>${word.sample ? '示例词块 · ' : '录入于 '}${safe(word.added)}</small>
      <h1>${safe(word.word)}</h1><p>${safe(word.meaning || '待补充中文释义')}</p>
    </div>
    <section class="panel">
      <h2>音标与发音</h2>
      <div class="pronunciation">
        <div><small>美式音标</small><p>${safe(word.us || '待补充')}</p><button data-speak="us">▷ 美式发音</button></div>
        <div><small>国际音标（IPA）</small><p>${safe(word.ipa || '待补充')}</p><button data-speak="uk">▷ 英式发音</button></div>
      </div>
    </section>
    <section class="panel"><h2>例句</h2><p>${safe(word.example || '待补充例句')}</p>${word.translation ? `<p class="muted">${safe(word.translation)}</p>` : ''}</section>
    ${word.sample ? '' : `<section class="panel"><div class="toolbar"><h2>熟悉程度</h2><button data-edit>编辑单词</button></div>
      <div class="level-options" role="group" aria-label="设置熟悉度">${levels.map((label, index) =>
        `<button class="level-${index}" data-level="${index}" aria-pressed="${index === word.level}">${label}</button>`).join('')}</div>
    </section>`}
  </article>`;
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
  const word = activeWord();
  for (const link of document.querySelectorAll('[data-page]')) {
    const active = link.dataset.page === (stats ? 'stats' : 'words');
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  $('#breadcrumb').textContent = stats ? '我的词库 / 学习统计' : '我的词库 / 单词本' + (word ? ' / 单词详情' : '');
  if (stats) showStats();
  else if (word) showWord(word);
  else wordList();
}

function openEditor(word = null) {
  editing = word;
  lookupData = word ? { usAudio: word.usAudio, ukAudio: word.ukAudio, word: word.word } : {};
  form.reset();
  for (const field of ['word', 'meaning', 'us', 'ipa', 'example', 'translation']) {
    fields[field].value = word?.[field] ?? '';
  }
  $('#form-status').textContent = '';
  $('#editor-title').textContent = word ? '编辑单词' : '添加单词';
  editor.showModal();
}

function speak(word, accent) {
  sound?.pause();
  window.speechSynthesis?.cancel();
  const fallback = () => {
    const lang = accent === 'us' ? 'en-US' : 'en-GB';
    const voice = window.speechSynthesis?.getVoices().find((item) => item.lang.toLowerCase().replace('_', '-') === lang.toLowerCase());
    if (!voice) {
      toast('当前设备没有可用的对应口音语音。');
      return;
    }
    const utterance = new SpeechSynthesisUtterance(word.word);
    utterance.lang = lang;
    utterance.voice = voice;
    utterance.onerror = ({ error }) => {
      if (error !== 'interrupted' && error !== 'canceled') toast('暂时无法播放发音。');
    };
    speechSynthesis.speak(utterance);
  };
  const url = word[accent + 'Audio'];
  if (!url) {
    fallback();
    return;
  }
  sound = new Audio(url);
  const currentSound = sound;
  sound.play().catch(() => {
    if (sound === currentSound) fallback();
  });
}

$('#add').addEventListener('click', () => openEditor());
for (const button of ['#cancel', '#close']) $(button).addEventListener('click', () => editor.close());
editor.addEventListener('close', () => lookupController?.abort());
$('#lookup').addEventListener('click', async () => {
  const word = fields.word.value.trim();
  if (!word) {
    fields.word.focus();
    return;
  }
  const controller = new AbortController();
  lookupController = controller;
  const timeout = setTimeout(() => controller.abort(), 7500);
  const status = $('#form-status');
  $('#lookup').disabled = true;
  status.textContent = '正在查词…';
  try {
    const response = await fetch('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(word), { signal: controller.signal });
    if (!response.ok) throw new Error('Lookup unavailable');
    const entries = await response.json();
    if (!editor.open) return;
    if (fields.word.value.trim() !== word) {
      status.textContent = '单词已修改，请重新查词。';
      return;
    }
    const phonetics = entries.flatMap((entry) => entry.phonetics ?? []);
    const accent = (name) => phonetics.find(({ audio }) => new RegExp('-' + name + '(?:[_.-]|$)', 'i').test(audio));
    const us = accent('us');
    const uk = accent('uk') ?? accent('gb');
    const example = entries.flatMap((entry) => entry.meanings ?? []).flatMap((meaning) => meaning.definitions ?? []).find((definition) => definition.example);
    fields.us.value ||= us?.text ?? '';
    fields.ipa.value ||= uk?.text ?? entries.find((entry) => entry.phonetic)?.phonetic ?? phonetics.find((item) => item.text)?.text ?? '';
    fields.example.value ||= example?.example ?? '';
    lookupData = { word, usAudio: us?.audio, ukAudio: uk?.audio };
    status.textContent = '已填入查到的音标和例句，缺少的内容可手动补充。';
  } catch {
    if (editor.open) status.textContent = '暂未查到结果，可以手动填写。';
  } finally {
    clearTimeout(timeout);
    $('#lookup').disabled = false;
  }
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const values = Object.fromEntries([...new FormData(form)].map(([name, value]) => [name, value.trim()]));
  if (!values.word) {
    $('#form-status').textContent = '请输入英文单词。';
    fields.word.focus();
    return;
  }
  if (words.some((word) => word.id !== editing?.id && word.word.toLowerCase() === values.word.toLowerCase())) {
    $('#form-status').textContent = '这个单词已在词库中。';
    return;
  }
  const entry = {
    ...(editing ?? { id: crypto.randomUUID(), added: ago(0), level: 0 }),
    ...values,
    usAudio: lookupData.word === values.word ? lookupData.usAudio : undefined,
    ukAudio: lookupData.word === values.word ? lookupData.ukAudio : undefined
  };
  const next = editing ? words.map((word) => word.id === entry.id ? entry : word) : [entry, ...words];
  if (!save(next)) return;
  editor.close();
  toast(editing ? '已保存修改' : '已添加到单词本');
  location.hash = '#word/' + entry.id;
  render();
});

view.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  const { scope: nextScope, chart, speak: accent, level } = button.dataset;
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
  if (accent) speak(word, accent);
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
  sound?.pause();
  window.speechSynthesis?.cancel();
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
