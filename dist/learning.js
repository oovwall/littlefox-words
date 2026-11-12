/* PDF extraction stays on this device. Online services receive only lookup or speech text. */
globalThis.Learning = (() => {
  const normalize = (text) => String(text ?? '').normalize('NFKC').replace(/[’‘]/g, "'")
    .replace(/[‐‑–—]/g, '-').replace(/\s+/g, ' ').trim();
  const termKey = (text) => normalize(text).toLowerCase();
  const escapePattern = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const containsTerm = (text, term) => {
    const target = termKey(term);
    if (!target) return false;
    const pattern = escapePattern(target).replace(/ /g, '\\s+');
    return new RegExp("(^|[^a-z0-9'])" + pattern + "($|[^a-z0-9'])", 'i').test(termKey(text));
  };
  const chinese = (text) => /[\u3400-\u9fff]/.test(text);
  const embeddedBytes = (element) => {
    const encoded = element.textContent.trim();
    return Uint8Array.fromBase64 ? Uint8Array.fromBase64(encoded)
      : Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  };
  const uniqueExamples = (items) => {
    const result = new Map();
    for (const item of items) {
      if (!item?.text?.trim()) continue;
      const key = termKey(item.text);
      const previous = result.get(key);
      result.set(key, previous ? {
        ...previous,
        translation: previous.translation || item.translation,
        terms: [...new Set([...(previous.terms ?? []), ...(item.terms ?? [])])],
        sources: [...new Map([...(previous.sources ?? []), ...(item.sources ?? [])]
          .map((source) => [source.documentId + ':' + source.page, source])).values()]
      } : { ...item, text: normalize(item.text) });
    }
    return [...result.values()];
  };

  async function fetchJson(url, signal) {
    const timeout = AbortSignal.timeout(4500);
    const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    if (!response.ok) throw new Error('Service unavailable');
    return response.json();
  }

  async function translate(text, signal) {
    const data = await fetchJson('https://api.mymemory.translated.net/get?' +
      new URLSearchParams({ q: text, langpair: 'en|zh-CN' }), signal);
    const translation = data.responseData?.translatedText?.trim();
    if (Number(data.responseStatus) !== 200 || !chinese(translation)) throw new Error('Translation unavailable');
    const decoder = document.createElement('textarea');
    decoder.innerHTML = translation;
    return decoder.value;
  }

  async function quickEntry(word) {
    const local = await localLookup(word);
    const [meaning, dictionary] = await Promise.allSettled([
      local.meaning || translate(word),
      fetchJson('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(word))
    ]);
    const phonetics = dictionary.status === 'fulfilled' && Array.isArray(dictionary.value)
      ? dictionary.value.flatMap((entry) => entry.phonetics ?? []) : [];
    const byAccent = (pattern) => phonetics.find(({ audio, text }) => text && pattern.test(audio ?? ''));
    const us = byAccent(/-us(?:[_.-]|$)/i);
    const uk = byAccent(/-(?:uk|gb)(?:[_.-]|$)/i);
    return { meaning: meaning.value, us: us?.text || local.us, uk: uk?.text };
  }

  let lexiconPromise;
  async function localLookup(word) {
    lexiconPromise ??= (async () => {
      const embedded = document.getElementById('word-lexicon');
      const stream = embedded ? new Blob([embeddedBytes(embedded)]).stream()
        : (await fetch(new URL('vendor/lexicon.json.gz', document.baseURI))).body;
      return new Response(stream.pipeThrough(new DecompressionStream('gzip'))).json();
    })().catch(() => ({}));
    const lexicon = await lexiconPromise;
    const record = Object.hasOwn(lexicon, termKey(word)) ? lexicon[termKey(word)] : [];
    const [meaning = '', us = '', ipa = '', examples = []] = record;
    return { meaning, us, ipa, examples: examples.map((text) => ({ text, source: 'WordNet' })) };
  }

  async function lookup(word, signal, hasPdfExamples = false) {
    const local = await localLookup(word);
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (local.meaning && local.us && local.ipa && (local.examples.length || hasPdfExamples)) {
      return { ...local, definitions: [], lookupMissing: [] };
    }
    const results = await Promise.allSettled([
      fetchJson('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(word), signal),
      local.meaning ? Promise.resolve(local.meaning) : translate(word, signal)
    ]);
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const entries = results[0].status === 'fulfilled' && Array.isArray(results[0].value) ? results[0].value : [];
    const phonetics = entries.flatMap((entry) => entry.phonetics ?? []);
    const accent = (name) => phonetics.find(({ audio }) => new RegExp('-' + name + '(?:[_.-]|$)', 'i').test(audio));
    const us = accent('us');
    const uk = accent('uk') ?? accent('gb');
    const definitions = entries.flatMap((entry) => entry.meanings ?? []).flatMap((meaning) =>
      (meaning.definitions ?? []).map((definition) => ({ ...definition, partOfSpeech: meaning.partOfSpeech })));
    const result = {
      meaning: results[1].status === 'fulfilled' ? results[1].value : '',
      us: local.us || us?.text || '',
      ipa: local.ipa || uk?.text || entries.find((entry) => entry.phonetic)?.phonetic || phonetics.find((item) => item.text)?.text || '',
      usAudio: us?.audio,
      ukAudio: uk?.audio,
      definitions: definitions.slice(0, 4).map(({ definition, partOfSpeech }) => ({ text: definition, partOfSpeech })),
      examples: uniqueExamples([...local.examples, ...definitions.filter((definition) => definition.example)
        .map(({ example }) => ({ text: example, source: '在线词典' }))]).slice(0, 8)
    };
    result.lookupMissing = [
      ...(!result.us ? ['美式音标'] : []),
      ...(!result.ipa ? ['国际音标'] : []),
      ...(!result.meaning ? ['中文释义'] : []),
      ...(!result.examples.length && !hasPdfExamples ? ['词典例句'] : [])
    ];
    return result;
  }

  let speechController;
  let audio;
  let voicePromise;
  function voices() {
    if (!window.speechSynthesis) return Promise.resolve([]);
    const available = speechSynthesis.getVoices();
    if (available.length) return Promise.resolve(available);
    voicePromise ??= new Promise((resolve) => {
      const done = () => {
        clearTimeout(timeout);
        speechSynthesis.removeEventListener('voiceschanged', done);
        resolve(speechSynthesis.getVoices());
        voicePromise = null;
      };
      const timeout = setTimeout(done, 1200);
      speechSynthesis.addEventListener('voiceschanged', done);
    });
    return voicePromise;
  }
  function stopSpeech() {
    speechController?.abort();
    audio?.pause();
    window.speechSynthesis?.cancel();
  }
  function playAudio(player, url, signal) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) { resolve(); return; }
      const finish = (error) => {
        clearTimeout(timeout);
        player.removeEventListener('playing', started);
        player.removeEventListener('ended', ended);
        player.removeEventListener('error', failed);
        signal.removeEventListener('abort', ended);
        error ? reject(error) : resolve();
      };
      const started = () => clearTimeout(timeout);
      const ended = () => finish();
      const failed = () => finish(new Error('Audio unavailable'));
      const timeout = setTimeout(() => { player.pause(); failed(); }, 9000);
      player.addEventListener('playing', started, { once: true });
      player.addEventListener('ended', ended, { once: true });
      player.addEventListener('error', failed, { once: true });
      signal.addEventListener('abort', ended, { once: true });
      player.src = url;
      player.play().catch(finish);
    });
  }
  async function speak(text, accent = 'us', recordedUrl, isSentence = false) {
    stopSpeech();
    speechController = new AbortController();
    const signal = speechController.signal;
    const language = accent === 'us' ? 'en-US' : 'en-GB';
    const chunks = text.match(/.{1,170}(?:\s+|$)|.{1,170}/gu) ?? [];
    const online = chunks.map((chunk) => 'https://translate.google.com/translate_tts?' +
      new URLSearchParams({ ie: 'UTF-8', client: 'tw-ob', tl: language, q: chunk.trim() }));
    const youdao = 'https://dict.youdao.com/dictvoice?' +
      new URLSearchParams({ audio: text, type: accent === 'us' ? '2' : '1' });
    const sources = [...(recordedUrl ? [[recordedUrl]] : []), online, ...(!isSentence ? [[youdao]] : [])];
    // Reuse the player for every fragment of a long sentence.
    const player = new Audio();
    audio = player;
    for (const urls of sources) {
      if (signal.aborted) return;
      try {
        for (const url of urls) await playAudio(player, url, signal);
        return;
      } catch {
        player.pause();
      }
    }
    const available = await voices();
    if (signal.aborted) return;
    const voice = available.find((item) => item.lang.replace('_', '-').toLowerCase() === language.toLowerCase())
      ?? (isSentence ? available.find((item) => /^en(?:[-_]|$)/i.test(item.lang)) : undefined);
    if (!voice) throw new Error('在线朗读暂时不可用，当前浏览器也未提供英语语音，请联网后重试。');
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = language;
    utterance.voice = voice;
    await new Promise((resolve, reject) => {
      const finish = () => {
        signal.removeEventListener('abort', finish);
        resolve();
      };
      utterance.onend = finish;
      utterance.onerror = ({ error }) => {
        if (error === 'interrupted' || error === 'canceled') finish();
        else {
          signal.removeEventListener('abort', finish);
          reject(new Error('朗读失败，请稍后重试。'));
        }
      };
      signal.addEventListener('abort', finish, { once: true });
      speechSynthesis.speak(utterance);
    });
  }

  let database;
  const databaseName = 'word-blocks.pdf-library' + (globalThis.wordBlocksAccount ? ':' + globalThis.wordBlocksAccount : '');
  function connectDatabase(name) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('documents', { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('无法打开 PDF 例句库，请检查浏览器存储权限。'));
    });
  }
  const openDatabase = () => database ??= connectDatabase(databaseName);
  async function documents(guest = false) {
    const db = await (guest ? connectDatabase('word-blocks.pdf-library') : openDatabase());
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('documents');
      const request = transaction.objectStore('documents').getAll();
      transaction.oncomplete = () => { if (guest) db.close(); resolve(request.result); };
      transaction.onabort = () => { if (guest) db.close(); reject(new Error('PDF 例句库读取失败。')); };
    });
  }
  async function deleteDocument(id) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('documents', 'readwrite');
      transaction.objectStore('documents').delete(id);
      transaction.oncomplete = resolve;
      transaction.onabort = () => reject(new Error('PDF 删除失败，请重试。'));
    });
  }
  async function storeDocument(record) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('documents', 'readwrite');
      transaction.objectStore('documents').put(record);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(new Error('PDF 保存失败，请检查浏览器剩余存储空间。'));
      transaction.onabort = () => reject(new Error('PDF 保存未完成，请重试。'));
    });
  }

  // Reconstruct physical rows before joining wrapped lines, retaining horizontal cell gaps.
  function textRows(items) {
    const rows = [];
    for (const item of items.filter((entry) => entry.str?.trim())) {
      const y = item.transform[5];
      const height = Math.abs(item.height || item.transform[3] || 10);
      let row = rows.find((entry) => Math.abs(entry.y - y) <= Math.min(entry.height, height) * 0.35);
      if (!row) {
        row = { y, height, items: [] };
        rows.push(row);
      }
      row.items.push({ text: item.str, x: item.transform[4], width: item.width, height });
    }
    return rows.sort((a, b) => b.y - a.y).map((row) => {
      const sorted = row.items.sort((a, b) => a.x - b.x);
      const cells = [];
      for (const item of sorted) {
        const previous = cells.at(-1);
        if (previous && item.x - previous.end < Math.max(12, item.height * 1.7)) {
          const gap = item.x - previous.end;
          const separator = gap > item.height * 0.12 && !previous.text.endsWith(' ') ? ' ' : '';
          previous.text += separator + item.text;
          previous.end = item.x + item.width;
        } else cells.push({ text: item.text, x: item.x, end: item.x + item.width });
      }
      return { y: row.y, height: row.height, cells: cells.map((cell) => ({ ...cell, text: normalize(cell.text) })) };
    });
  }

  function extractExamples(items, pageNumber) {
    const rows = textRows(items);
    const records = [];
    const pending = new Map();
    const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
    let currentTerm = '';
    const headword = (text) => {
      const clean = normalize(text).split(/[\u3400-\u9fff]/, 1)[0].replace(/^\d+[.)]?\s*/, '')
        .replace(/\s*(?:\([^)]*\)|\[[^\]]*\]|\/[^/]*\/)\s*$/, '').trim();
      if (/^(?:vocabulary|word|words|meaning|example|sentence|examples|page|little fox|name|date|definition)$/i.test(clean)) return '';
      if (!/^[a-z](?:[a-z' -]{0,58}[a-z])?$/.test(clean) || clean.split(' ').length > 5) return '';
      return clean;
    };
    const flush = (key) => {
      const block = pending.get(key);
      if (!block) return;
      for (const part of segmenter.segment(block.text)) {
        const text = normalize(part.segment);
        if (text.split(/\s+/).length < 3 || !/[a-z]/i.test(text)) continue;
        if (!/[.!?]["'”’)]*$/.test(text)) continue;
        if (/copyright|www\.|https?:|all rights reserved/i.test(text)) continue;
        records.push({ text, terms: block.term ? [termKey(block.term)] : [], page: pageNumber });
      }
      pending.delete(key);
    };
    for (const row of rows) {
      const numbered = row.cells[0]?.text.replace(/^\d+[.)]?$/, '').trim() === '';
      const candidateCell = row.cells[numbered ? 1 : 0];
      const candidate = candidateCell ? headword(candidateCell.text) : '';
      // An isolated lowercase headword or first table cell anchors following example text.
      const previous = candidateCell && pending.get(Math.round(candidateCell.x / 28));
      const continuing = previous && Math.abs(previous.y - row.y) <= row.height * 2.5;
      const isHeading = candidate && (row.cells.length > (numbered ? 2 : 1) || (row.cells.length === 1 && !continuing));
      if (isHeading) {
        for (const key of pending.keys()) flush(key);
        currentTerm = candidate;
      }
      for (const cell of row.cells) {
        if (isHeading && cell === candidateCell) continue;
        const text = cell.text.replace(/^(?:example(?: sentence)?\s*[:：]?|e\.g\.\s*)\s*/i, '')
          .split(/[\u3400-\u9fff]/, 1)[0].trim();
        if (chinese(text) || !/[a-z]/i.test(text)) continue;
        if (/^(?:[[(]?(?:n|v|adj|adv|pron|prep|conj|interj)\.[\])]?\s*)/i.test(text)) continue;
        if (/^vocabulary\b|copyright|www\.|https?:|all rights reserved/i.test(text)) continue;
        const key = Math.round(cell.x / 28);
        const previous = pending.get(key);
        if (previous && Math.abs(previous.y - row.y) > row.height * 2.5) flush(key);
        const block = pending.get(key);
        if (block) {
          block.text += (/-$/.test(block.text) ? '' : ' ') + text;
          block.y = row.y;
        } else pending.set(key, { text, term: currentTerm, y: row.y });
        if (/[.!?]["'”’)]*$/.test(text)) flush(key);
      }
    }
    for (const key of pending.keys()) flush(key);
    return uniqueExamples(records.map((record) => ({ ...record, sources: [] })));
  }

  let pdfLibrary;
  async function pdfjs() {
    pdfLibrary ??= (async () => {
      const embedded = document.getElementById('pdfjs-module');
      const moduleUrl = embedded ? URL.createObjectURL(new Blob([embeddedBytes(embedded)],
        { type: 'text/javascript' })) : new URL('vendor/pdf.mjs', document.baseURI).href;
      const library = await import(moduleUrl);
      const worker = document.getElementById('pdfjs-worker');
      library.GlobalWorkerOptions.workerSrc = worker ? URL.createObjectURL(new Blob([embeddedBytes(worker)],
        { type: 'text/javascript' })) : new URL('vendor/pdf.worker.mjs', document.baseURI).href;
      return library;
    })();
    return pdfLibrary;
  }

  async function parsePdf(file, onProgress, knownIds = new Set()) {
    const data = await file.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', data);
    const id = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    if (knownIds.has(id)) return { id, duplicate: true };
    const library = await pdfjs();
    const task = library.getDocument({ data: new Uint8Array(data), isEvalSupported: false, useSystemFonts: true });
    let pdf;
    try {
      pdf = await task.promise;
      const examples = [];
      let textLength = 0;
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        onProgress(pageNumber, pdf.numPages);
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        textLength += content.items.reduce((sum, item) => sum + (item.str?.length ?? 0), 0);
        examples.push(...extractExamples(content.items, pageNumber));
        page.cleanup();
      }
      if (textLength < 10) throw new Error('没有可提取的文字。这份 PDF 可能是扫描图片，请使用带文字的 PDF。');
      if (!examples.length) throw new Error('未识别到完整英文例句，请检查 PDF 是否包含例句。');
      return { id, name: file.name, added: new Date().toISOString(), pageCount: pdf.numPages, examples, file };
    } finally {
      await task.destroy();
    }
  }

  const matchCache = new WeakMap();
  function matchedExamples(word, library) {
    let cache = matchCache.get(library);
    if (!cache) {
      cache = new Map();
      matchCache.set(library, cache);
    }
    const key = termKey(word);
    if (!cache.has(key)) {
      cache.set(key, uniqueExamples(library.flatMap((pdf) => pdf.examples
        .filter((example) => example.terms?.includes(key) || containsTerm(example.text, key))
        .map((example) => ({
          text: example.text, translation: example.translation,
          sources: [{ documentId: pdf.id, name: pdf.name, page: example.page }]
        })))));
    }
    return cache.get(key);
  }

  function scoreSentence(expected, transcript) {
    const tokens = (value) => termKey(value).match(/[\p{L}\p{N}]+(?:'[\p{L}]+)*/gu) ?? [];
    const target = tokens(expected);
    const spoken = tokens(transcript);
    const distance = Array.from({ length: target.length + 1 }, (_, row) =>
      Array.from({ length: spoken.length + 1 }, (_, column) => row === 0 ? column : column === 0 ? row : 0));
    for (let row = 1; row <= target.length; row++) {
      for (let column = 1; column <= spoken.length; column++) {
        distance[row][column] = Math.min(distance[row - 1][column] + 1, distance[row][column - 1] + 1,
          distance[row - 1][column - 1] + Number(target[row - 1] !== spoken[column - 1]));
      }
    }
    const missing = [], extra = [], substitutions = [];
    let row = target.length, column = spoken.length;
    const edits = distance[row][column];
    while (row || column) {
      if (row && column && target[row - 1] === spoken[column - 1]) {
        row--;
        column--;
      } else if (row && column && distance[row][column] === distance[row - 1][column - 1] + 1) {
        substitutions.unshift([target[--row], spoken[--column]]);
      } else if (row && distance[row][column] === distance[row - 1][column] + 1) {
        missing.unshift(target[--row]);
      } else {
        extra.unshift(spoken[--column]);
      }
    }
    return { score: target.length ? Math.max(0, Math.round(100 * (1 - edits / target.length))) : 0,
      missing, extra, substitutions };
  }

  return { normalize, termKey, containsTerm, uniqueExamples, lookup, speak, stopSpeech, scoreSentence, quickEntry,
    documents, storeDocument, deleteDocument, parsePdf, matchedExamples, textRows, extractExamples };
})();
