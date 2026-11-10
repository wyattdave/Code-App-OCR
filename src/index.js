import { info, initialize, recognizePixels, disposeEngine, setObserver } from './engine.js';
import { parse, scoreResult, moneyTokens, describeCurrency } from './parser.js';
import { decodeImage, border, crop, findPaper, resize, normalizeLighting, estimateSkew, rotate } from './image.js';
import { recognizeHeadings, recognizeDates, selectFinancialFields } from './fields.js';
export { parse, info };

let pending = Promise.resolve(), progress = null;
function report(status, value) { try { progress?.({ status, progress: value }); } catch { /* Observer errors do not abort OCR. */ } }
function enqueue(task) { const result = pending.then(task); pending = result.catch(() => {}); return result; }

// Reassemble words by visual baseline, not Tesseract block order. Sparse mode
// otherwise separates labels and their prices into different text blocks.
export function rowsFromTSV(tsv) {
  const words = tsv.split('\n').slice(1).map(line => {
    const c = line.split('\t');
    return { level: +c[0], left: +c[6], top: +c[7], width: +c[8], height: +c[9], confidence: +c[10], text: c.slice(11).join('\t').trim() };
  }).filter(w => w.level === 5 && w.text && w.confidence >= 0);
  const rows = [];
  for (const word of words.sort((a, b) => a.top + a.height / 2 - b.top - b.height / 2)) {
    const center = word.top + word.height / 2;
    let row = rows.at(-1);
    if (!row || Math.abs(row.center - center) > Math.max(4, Math.min(row.height, word.height) * .55)) {
      row = { center, height: word.height, words: [] }; rows.push(row);
    }
    row.words.push(word);
    row.center = row.words.reduce((sum, w) => sum + w.top + w.height / 2, 0) / row.words.length;
    row.height = Math.max(row.height, word.height);
  }
  return rows.map(row => {
    row.words.sort((a, b) => a.left - b.left);
    return { text: row.words.map(w => w.text).join(' '), words: row.words, left: Math.min(...row.words.map(w => w.left)),
      right: Math.max(...row.words.map(w => w.left + w.width)), top: Math.min(...row.words.map(w => w.top)),
      bottom: Math.max(...row.words.map(w => w.top + w.height)), confidence: row.words.reduce((s, w) => s + w.confidence, 0) / row.words.length };
  });
}
export function textFromTSV(tsv) { return rowsFromTSV(tsv).map(row => row.text).join('\n'); }

async function runPass(image, mode, name, options, includeLayout = true) {
    const { rawText, confidence, tsv } = await recognizePixels(border(image), mode, { alphabet: name === 'amount' ? '0123456789.,-$£€¥₩₱()' : '', layout: includeLayout });
    const result = { ...parse(rawText, options), confidence, pass: name };
    if (!includeLayout) return result;
    const rows = rowsFromTSV(tsv);
    const layout = { ...parse(rows.map(row => row.text).join('\n'), options), confidence, pass: name + ':layout' };
    const chosen = scoreResult(layout) > scoreResult(result) ? layout : result;
    const other = chosen === layout ? result : layout;
    chosen._rows = rows; chosen._image = image;
    const fieldConfidence = value => Object.fromEntries(Object.entries(value.evidence).map(([field, evidence]) => {
      const list = Array.isArray(evidence) ? evidence : [evidence];
      const compact = text => text?.toLowerCase().replace(/\s+/g, '');
      const matched = rows.filter(row => list.some(e => compact(e.rawLine) === compact(row.text)));
      const numbers = matched.flatMap(row => row.words.filter(w => moneyTokens(w.text).length).map(w => w.confidence));
      return [field, numbers.length ? Math.min(...numbers) : matched.length ? Math.min(...matched.map(row => row.confidence)) : confidence];
    }));
    chosen.fieldConfidence = fieldConfidence(chosen);
    if (layout.rawText.trim() !== result.rawText.trim()) {
      other._rows = rows; other._image = image; chosen._alternative = other;
      other.fieldConfidence = fieldConfidence(other);
    }
    return chosen;
}

export function init() { return enqueue(async () => { await initialize(); return info; }); }
export function dispose() {
  return enqueue(disposeEngine);
}

export function recognize(input, options = {}) {
  return enqueue(async () => {
    const { maxDimension = 2400, pageSegMode, onProgress, dateOrder, quality = 'photo' } = options;
    if (pageSegMode !== undefined && ![3, 6, 11].includes(pageSegMode)) throw new RangeError('pageSegMode must be 3, 6, or 11.');
    if (onProgress !== undefined && typeof onProgress !== 'function') throw new TypeError('onProgress must be a function.');
    if (!['photo', 'fast'].includes(quality)) throw new RangeError('quality must be photo or fast.');
    if (dateOrder !== undefined && !['MDY', 'DMY'].includes(dateOrder)) throw new RangeError('dateOrder must be MDY or DMY.');
    progress = onProgress || null;
    setObserver(progress);
    const started = performance.now(), attempts = [];
    const add = (result, fieldImage) => {
      result._fieldImage = fieldImage || result._image;
      attempts.push(result);
      if (result._alternative) { result._alternative._fieldImage = result._fieldImage; attempts.push(result._alternative); delete result._alternative; }
    };
    try {
      report('preparing image', 0);
      const image = await decodeImage(input, maxDimension), rect = findPaper(image);
      const paper = rect ? crop(image, rect) : image;
      const upscale = value => {
        const factor = Math.min(3, maxDimension / Math.max(value.width, value.height));
        return factor > 1.05 ? resize(value, Math.round(value.width * factor), Math.round(value.height * factor)) : value;
      };
      const prepared = upscale(paper);
      const angle = estimateSkew(prepared);
      const straight = angle ? rotate(prepared, angle) : prepared;
      const originalImage = paper === image && !angle ? prepared : upscale(image);
      add(await runPass(straight, pageSegMode ?? 3, 'paper', options));
      if (quality === 'photo') {
        add(await runPass(normalizeLighting(straight), pageSegMode ?? 6, 'local-contrast', options), straight);
        add(await runPass(normalizeLighting(straight), pageSegMode ?? 11, 'sparse', options), straight);
        // Keep an uncropped, unrotated fallback; paper detection must never erase evidence.
        const original = await runPass(originalImage, pageSegMode ?? 6, 'original', options);
        add(original);
        if (original.total === null || original.tax === null) add(await runPass(originalImage, pageSegMode ?? 3, 'auto-layout', options));
      }
      let headingDiagnostics = [];
      if (quality === 'photo') {
        report('reading financial headings', 0);
        const focused = await recognizeHeadings(attempts, recognizePixels);
        headingDiagnostics = focused.diagnostics;
        attempts.push(...focused.documents);
      }
      // Prefer mutually corroborated monetary values over a single lucky-looking pass.
      const corroborated = (field, value, source) => new Set(attempts.filter(a => a !== source && a[field] === value).map(a => a.pass.split(':')[0])).size;
      for (const result of attempts) {
        result.selectionScore = scoreResult(result);
        for (const field of ['total', 'tax']) if (result[field] !== null) {
          result.selectionScore += Math.min(6, corroborated(field, result[field], result) * 3);
        }
      }
      attempts.sort((a, b) => b.selectionScore - a.selectionScore);
      // Keep a full-document transcription; focused reads contribute field evidence.
      const base = attempts.find(a => !/^(?:heading|band):/.test(a.pass)) || attempts[0];
      const result = { ...base, warnings: [...base.warnings], evidence: { ...base.evidence }, fieldConfidence: { ...base.fieldConfidence } };
      const financial = selectFinancialFields(attempts, result);
      for (const field of ['total', 'tax', 'subtotal']) if (financial?.[field]) {
        const chosen = financial[field];
        result[field] = chosen.cents / 100;
        result.fieldConfidence[field] = chosen.confidence;
        result.evidence[field] = { source: chosen.evidence, pass: chosen.source.pass,
          ...(chosen.source._fieldReadings ? { regions: chosen.source._fieldReadings.filter(r => r.type === field) } : {}) };
        if (field === 'tax') result.taxLines = chosen.source.taxLines;
      }
      if (financial?.total) {
        const source = financial.total.source;
        const regionSymbol = source._fieldReadings?.find(r => r.type === 'total' && r.symbol)?.symbol;
        const primaryLine = source.evidence.total?.rawLine || '';
        const symbol = regionSymbol || moneyTokens(primaryLine).flatMap(t => t.text.match(/[$£€¥₩₱元円]/g) || [])[0];
        if (symbol) Object.assign(result, describeCurrency(source.currency, symbol));
      }
      // Missing fields may be recovered from another pass, with their own evidence
      // retained. Values are always actually observed, never calculated to fit.
      for (const field of ['merchant', 'date', 'tax', 'subtotal', 'currencySymbol']) if (result[field] === null) {
        const source = attempts.find(a => a[field] !== null && (a.fieldConfidence?.[field] ?? a.confidence) >= 60);
        if (source && (field !== 'tax' || result.total === null || source.tax <= Math.abs(result.total))) {
          result[field] = source[field];
          result.evidence[field] = { source: source.evidence[field], pass: source.pass };
          if (field === 'date') result.dateRaw = source.dateRaw;
          if (field === 'tax') result.taxLines = source.taxLines;
        }
      }
      Object.assign(result, describeCurrency(result.currency, result.currencySymbol));
      if (quality === 'photo' && (!result.date || (result.fieldConfidence.date || 0) < 80 || new Set(attempts.filter(a => a.date).map(a => a.date)).size > 1)) {
        report('reading date formats', 0);
        const focusedDates = await recognizeDates(attempts, recognizePixels, options);
        const candidates = [
          ...attempts.filter(a => a.date).map(a => ({ value: a.date, raw: a.dateRaw, confidence: a.fieldConfidence?.date ?? a.confidence, rawLine: a.evidence.date?.rawLine, pass: a.pass.split(':')[0] })),
          ...focusedDates,
        ];
        const ranked = [...new Set(candidates.map(c => c.value))].map(value => {
          const values = candidates.filter(c => c.value === value).sort((a, b) => b.confidence - a.confidence);
          return { ...values[0], score: values[0].confidence / 10 + new Set(values.map(c => c.pass)).size * 2 };
        }).sort((a, b) => b.score - a.score);
        if (ranked.length) { result.date = ranked[0].value; result.dateRaw = ranked[0].raw; result.evidence.date = ranked[0]; result.fieldConfidence.date = ranked[0].confidence; }
      }
      if (quality === 'photo') {
        // A separate header read helps logos and multi-line names, without using
        // a merchant dictionary or interpreting item names as business names.
        const headerImage = crop(prepared, { left: 0, right: prepared.width, top: 0, bottom: Math.max(1, Math.round(prepared.height * .35)) });
        const header = await runPass(headerImage, 6, 'header', options);
        if (header.merchant && (header.fieldConfidence?.merchant ?? header.confidence) >= 65) {
          const normalizeName = text => text?.toLowerCase().replace(/[^a-z0-9]/g, '');
          const support = attempts.filter(a => normalizeName(a.merchant) === normalizeName(header.merchant)).length;
          const oldSupport = attempts.filter(a => normalizeName(a.merchant) === normalizeName(result.merchant)).length;
          if (!result.merchant || support >= oldSupport || (result.fieldConfidence?.merchant ?? result.confidence) < 55) {
            result.merchant = header.merchant; result.evidence.merchant = { source: header.evidence.merchant, pass: 'header' };
          }
        }
      }
      result.warnings = result.warnings.filter(w => !['merchant', 'date', 'total', 'tax', 'subtotal'].some(f => result[f] !== null && w.startsWith(`Missing ${f}:`)));
      result.warnings = result.warnings.filter(w => !w.includes('mismatch with total'));
      delete result.arithmeticMatches;
      if (result.total !== null && result.subtotal !== null && result.tax !== null && !result.warnings.some(w => w.startsWith('Included tax'))) {
        const expected = result.subtotal + result.tax + (result.tip || 0) + (result.serviceCharge || 0) - Math.abs(result.discount || 0);
        result.arithmeticMatches = Math.abs(Math.round(expected * 100) - Math.round(result.total * 100)) <= 1;
        if (!result.arithmeticMatches) result.warnings.push('Subtotal + tax + tip + fees - discount mismatch with total; extracted values were not changed.');
      }
      for (const field of ['total', 'tax']) {
        const alternatives = [...new Set(attempts.filter(a => a.confidence >= 50 && a[field] !== null).map(a => a[field]))];
        if (alternatives.length > 1) result.warnings.push(`OCR passes disagree on ${field}: ${alternatives.join(', ')}. Human review required.`);
      }
      if (result.confidence < 75) result.warnings.push('Low OCR confidence: verify all extracted values against the receipt.');
      if (!result.rawText.trim()) result.warnings.push('No text recognized. Use a clear, upright, tightly cropped receipt.');
      result.processingMs = Math.round(performance.now() - started);
      result.preprocessing = { paperCrop: rect, deskewDegrees: Math.round(angle * 10) / 10 };
      if (options.debug) result.headingDiagnostics = headingDiagnostics;
      result.attempts = attempts.map(a => ({ pass: a.pass, confidence: a.confidence, total: a.total, tax: a.tax, merchant: a.merchant, date: a.date, score: a.selectionScore,
        ...(options.debug ? { rawText: a.rawText, rows: a._rows } : {}) }));
      delete result.selectionScore;
      delete result._rows; delete result._image; delete result._fieldImage;
      report('complete', 1);
      return result;
    } finally { progress = null; setObserver(null); }
  });
}
