globalThis.WordReview = (() => {
  const intervals = [1, 3, 7, 14, 30, 60];
  const normalize = (text) => Learning.termKey(text);
  function schedule(word, rating, today, dateAfter) {
    const previous = word.review ?? {};
    const step = Math.min(previous.step ?? 0, intervals.length - 1);
    const interval = rating === 'again' ? 0 : rating === 'hard' ? 1 : intervals[step];
    const level = rating === 'again' ? 0 : rating === 'hard' ? Math.min(1, word.level) : Math.min(3, word.level + 1);
    return {
      ...word, level, masteredOn: level === 3 ? word.masteredOn || today : undefined,
      review: {
        step: rating === 'again' ? 0 : rating === 'hard' ? Math.max(0, step - 1) : Math.min(step + 1, intervals.length - 1),
        due: dateAfter(interval), last: today, rating,
        attempts: (previous.attempts ?? 0) + 1,
        lapses: (previous.lapses ?? 0) + Number(rating === 'again')
      }
    };
  }
  const due = (word, date) => (word.review?.due ?? word.added) <= date;
  function cloze(word, examples) {
    const term = word.word.trim().split(/\s+/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
    const pattern = new RegExp("(^|[^a-z0-9'])(" + term + ")($|[^a-z0-9'])", 'i');
    for (const example of examples) {
      const match = pattern.exec(example.text);
      if (match) {
        const start = match.index + match[1].length;
        return { ...example, prompt: example.text.slice(0, start) + '____' + example.text.slice(start + match[2].length) };
      }
    }
    return null;
  }
  return { schedule, due, cloze, normalize };
})();
