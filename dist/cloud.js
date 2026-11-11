(() => {
  const session = Clerk.session;
  const partSize = 1024 * 1024;

  async function request(params, body) {
    if (Clerk.session?.id !== session.id) throw new Error('账号已切换，请重新打开词库。');
    const token = await session.getToken();
    if (!token || Clerk.session?.id !== session.id) throw new Error('登录已失效，请重新登录。');
    const response = await fetch('/api/library?' + new URLSearchParams(params), {
      method: body ? 'PUT' : 'GET',
      headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || '同步失败，请稍后重试。');
    return data;
  }

  async function list(kind) {
    const items = [];
    let cursor = '';
    do {
      const page = await request({ kind, cursor });
      items.push(...page.items);
      cursor = page.cursor;
    } while (cursor);
    return items;
  }

  function saveWord(word, revision, importOnly = false) {
    const { syncRevision, ...data } = word;
    return request({}, { kind: 'word', data, revision, importOnly });
  }

  async function uploadPdf(pdf) {
    const { file, ...metadata } = pdf;
    const parts = Math.ceil(file.size / partSize);
    if (parts < 1 || parts > 50) throw new Error('同步的 PDF 必须小于或等于 50 MiB。');
    const data = { ...metadata, parts };
    if (new Blob([JSON.stringify(data)]).size > 3000000) throw new Error('PDF 提取出的例句过多，请拆分后导入。');
    for (let index = 0; index < parts; index++) {
      const bytes = new Uint8Array(await file.slice(index * partSize, (index + 1) * partSize).arrayBuffer());
      const base64 = bytes.toBase64 ? bytes.toBase64() : btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
      await request({}, { kind: 'part', key: pdf.id + '.' + index, data: base64 });
    }
    await request({}, { kind: 'pdf', data });
    return data;
  }

  async function downloadPdf(pdf) {
    const parts = [];
    for (let index = 0; index < pdf.parts; index++) {
      const base64 = await request({ kind: 'part', key: pdf.id + '.' + index });
      parts.push(Uint8Array.from(atob(base64), (character) => character.charCodeAt(0)));
    }
    return new Blob(parts, { type: 'application/pdf' });
  }

  window.WordBlocksCloud = { list, saveWord, uploadPdf, downloadPdf };
})();
