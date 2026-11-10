// Heading-led recognition. This module knows field syntax and geometry, never
// receipt names, filenames, expected values, retailer layouts, or tax rates.
import { classifyLabel, moneyTokens, extractDates, parse } from './parser.js';
import { crop, border, resize, binarize, normalizeLighting } from './image.js';

export function headingAnchors(rows) {
  const anchors = [];
  for (const row of rows) {
    const words = row.words;
    for (let index = 0; index < words.length; index++) {
      const word = words[index];
      if (word.confidence < 20) continue;
      let start = index, end = index;
      const h = word.height;
      if (index > 0 && /^(?:sub|grand|sales|state|local|total|amount|balance|check|receipt|food|bar)$/i.test(words[index - 1].text.replace(/[^a-z]/gi, '')) && word.left - words[index - 1].left - words[index - 1].width < h * 3) start--;
      while (end + 1 < words.length && /^(?:total|due|tax|taxes|ttc|paid)$/i.test(words[end + 1].text.replace(/[^a-z]/gi, '')) && words[end + 1].left - words[end].left - words[end].width < h * 3) end++;
      const tokens = words.slice(start, end + 1), label = tokens.map(w => w.text).join(' '), kind = classifyLabel(label);
      if (!kind || !['total', 'subtotal', 'tax', 'tip', 'serviceCharge'].includes(kind.type)) continue;
      const anchor = { ...kind, label, left: Math.min(...tokens.map(w => w.left)) - 24, right: Math.max(...tokens.map(w => w.left + w.width)) - 24,
        top: Math.min(...tokens.map(w => w.top)) - 24, bottom: Math.max(...tokens.map(w => w.top + w.height)) - 24,
        confidence: tokens.reduce((sum, w) => sum + w.confidence, 0) / tokens.length };
      anchor.height = anchor.bottom - anchor.top; anchor.center = (anchor.top + anchor.bottom) / 2;
      if (!anchors.some(a => a.type === anchor.type && Math.abs(a.center - anchor.center) < h * .5)) anchors.push(anchor);
      index = end;
    }
  }
  return anchors.sort((a, b) => a.center - b.center);
}

function paymentAnchors(rows, after, before, width) {
  const guards = [];
  for (const row of rows) for (const word of row.words) {
    if (!/^(?:cash|change|tendered|visa|mastercard|payment|credit|debit|cg)$/i.test(word.text.replace(/[^a-z]/gi, ''))) continue;
    const center = word.top + word.height / 2 - 24;
    if (center < after || center > before || word.left > width * .55) continue;
    guards.push({ type: 'payment', rank: 0, label: word.text, left: word.left - 24, right: word.left + word.width - 24,
      top: word.top - 24, bottom: word.top + word.height - 24, height: word.height, center, confidence: word.confidence });
  }
  return guards;
}

// Find glyph groups in the amount column independently of OCR's line grouping.
// This prevents a skewed amount from being attached to the preceding heading.
export function amountRegions(image, rect, textHeight) {
  const block = crop(image, rect), binary = binarize(block);
  const { width: w, height: h, pixels } = binary;
  const seen = new Uint8Array(pixels.length), queue = new Int32Array(pixels.length), components = [];
  for (let start = 0; start < pixels.length; start++) {
    if (pixels[start] || seen[start]) continue;
    let head = 0, tail = 1, left = w, right = 0, top = h, bottom = 0;
    queue[0] = start; seen[start] = 1;
    while (head < tail) {
      const pos = queue[head++], x = pos % w, y = Math.floor(pos / w);
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, next = ny * w + nx;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h || seen[next] || pixels[next]) continue;
        seen[next] = 1; queue[tail++] = next;
      }
    }
    const cw = right - left + 1, ch = bottom - top + 1;
    if (tail < 2 || ch > textHeight * 3 || cw > textHeight * 4 || (cw > textHeight * 2 && ch < textHeight * .25)) continue;
    components.push({ left, right: right + 1, top, bottom: bottom + 1, width: cw, height: ch, count: tail });
  }
  const rows = [];
  for (const c of components.filter(c => c.height >= textHeight * .35).sort((a, b) => a.top + a.height / 2 - b.top - b.height / 2)) {
    const center = c.top + c.height / 2;
    const row = rows.find(r => Math.abs(r.center - center) < Math.max(textHeight * .28, Math.min(r.height, c.height) * .48));
    if (row) { row.parts.push(c); row.center = row.parts.reduce((sum, p) => sum + p.top + p.height / 2, 0) / row.parts.length; row.height = Math.max(row.height, c.height); }
    else rows.push({ center, height: c.height, parts: [c] });
  }
  const regions = [];
  for (const row of rows) {
    const parts = row.parts.sort((a, b) => a.left - b.left), groups = [];
    for (const c of parts) {
      const group = groups.at(-1);
      if (group && c.left - group.at(-1).right < textHeight * 1.5) group.push(c);
      else groups.push([c]);
    }
    for (const group of groups) {
      if (group.length < 2) continue;
      let left = Math.min(...group.map(c => c.left)), right = Math.max(...group.map(c => c.right));
      let top = Math.min(...group.map(c => c.top)), bottom = Math.max(...group.map(c => c.bottom));
      // Include decimal points and detached currency strokes without adding ink.
      const dots = components.filter(c => c.height < textHeight * .35 && c.left >= left - textHeight * .3 && c.right <= right + textHeight * .3 && c.top >= top && c.bottom <= bottom + textHeight * .2);
      for (const c of dots) { left = Math.min(left, c.left); right = Math.max(right, c.right); bottom = Math.max(bottom, c.bottom); }
      const pad = Math.max(2, textHeight * .12);
      const region = { left: Math.max(0, rect.left + left - pad), right: Math.min(image.width, rect.left + right + pad), top: Math.max(0, rect.top + top - pad), bottom: Math.min(image.height, rect.top + bottom + pad), center: rect.top + (top + bottom) / 2 };
      if (region.right - region.left < textHeight * .5) continue;
      regions.push(region);
    }
  }
  return regions.sort((a, b) => a.center - b.center || a.left - b.left);
}

export function alignAmounts(anchors, regions) {
  // Allow a consistent vertical offset between printed label and amount columns.
  // Price values play no role in geometric matching.
  const shifts = [0];
  for (const a of anchors) for (const r of regions) if (Math.abs(r.center - a.center) < a.height * 2.5) shifts.push(r.center - a.center);
  const assignments = [];
  for (const shift of shifts) {
    const chosen = [], used = new Set(); let score = 0, previous = -Infinity;
    for (const a of anchors) {
      const options = regions.map((r, i) => ({ ...r, i, cost: Math.abs(r.center - a.center - shift) / Math.max(8, a.height) }))
        .filter(r => !used.has(r.i) && r.center > previous && r.cost < 2)
        .sort((a, b) => a.cost - b.cost || b.right - a.right);
      if (options.length) { const r = options[0]; used.add(r.i); chosen.push({ anchor: a, region: r, cost: r.cost }); score += 2 - r.cost; previous = r.center; }
    }
    score -= Math.abs(shift) / Math.max(8, ...anchors.map(a => a.height)) * .25;
    // A displaced column needs at least two supporting rows. A single distant
    // item price must not become tax merely by shifting the matching window.
    if (chosen.length < 2 && Math.abs(shift) > Math.max(8, ...anchors.map(a => a.height)) * .75) continue;
    assignments.push({ score, chosen });
  }
  assignments.sort((a, b) => b.score - a.score);
  const candidates = [];
  for (const [alignment, assignment] of assignments.slice(0, 3).entries()) for (const c of assignment.chosen) {
    candidates.push({ ...c, cost: c.cost + Math.abs(c.region.center - c.anchor.center) / Math.max(8, c.anchor.height) * .35 +
      (assignments[0].score - assignment.score) / Math.max(1, anchors.length), alignment, alignmentScore: assignment.score });
  }
  return candidates;
}

export async function readAmount(image, rect, recognizePixels) {
  const region = crop(image, rect), reads = [];
  // Normalize the glyph height, rather than blindly enlarging the entire photo.
  for (const [variant, stretch] of [['gray', 1], ['binary', 1], ['binary', 1.6], ['contrast', 1], ['contrast', 1.6]]) {
    const scale = 44 / Math.max(1, region.height);
    let pixels = resize(region, Math.max(1, Math.round(region.width * scale * stretch)), 44);
    if (variant === 'binary') pixels = binarize(pixels);
    if (variant === 'contrast') pixels = normalizeLighting(pixels);
    const read = await recognizePixels(border(pixels, 16), 7, { alphabet: '0123456789.,-$£€¥₩₱()%', layout: false });
    const text = read.rawText.trim().replace(/(\d)\s*([.,])\s*(\d{2})(?!\d)/g, '$1$2$3');
    const amounts = moneyTokens(text);
    if (amounts.length === 1 && /^[\s\d.,$£€¥₩₱()\-]+$/.test(text) && read.confidence >= 20) reads.push({ cents: amounts[0].cents, symbol: amounts[0].text.match(/[$£€¥₩₱]/)?.[0] || null, text, confidence: read.confidence, variant: `${variant}:${stretch}` });
  }
  const values = [...new Set(reads.map(r => r.cents))].map(cents => {
    const votes = reads.filter(r => r.cents === cents);
    return { cents, reads: votes, confidence: Math.max(...votes.map(r => r.confidence)), support: votes.length,
      symbol: votes.find(r => r.symbol)?.symbol || null, text: votes.sort((a, b) => b.confidence - a.confidence)[0].text };
  });
  return values.sort((a, b) => b.support - a.support || b.confidence - a.confidence);
}

export async function recognizeHeadings(attempts, recognizePixels) {
  const sources = [];
  for (const a of attempts) {
    if (!a._rows || !a._image) continue;
    const anchors = headingAnchors(a._rows).filter(h => ['total', 'tax', 'subtotal'].includes(h.type));
    if (!anchors.length) continue;
    const score = anchors.reduce((sum, h) => sum + (h.type === 'total' ? 3 : 1) + h.confidence / 100, 0);
    const image = a._fieldImage || a._image;
    const previous = sources.find(s => s.image === image);
    if (previous && previous.score >= score) continue;
    if (previous) sources.splice(sources.indexOf(previous), 1);
    sources.push({ image, anchors, score, pass: a.pass, rows: a._rows });
  }
  const evidence = [], diagnostics = [], documents = [];
  for (const source of sources.sort((a, b) => b.score - a.score).slice(0, 2)) {
    const { image } = source;
    const anchors = source.anchors.filter(a => a.height >= 4 && a.right < image.width * .85);
    if (!anchors.length) continue;
    const height = [...anchors].sort((a, b) => a.height - b.height)[Math.floor(anchors.length / 2)].height;
    anchors.push(...paymentAnchors(source.rows, Math.min(...anchors.map(a => a.top)), Math.max(...anchors.map(a => a.bottom)) + height * 5, image.width));
    anchors.sort((a, b) => a.center - b.center);
    let left = Math.max(0, Math.max(...anchors.map(a => a.right)) + height * .3), right = image.width;
    const top = Math.max(0, Math.min(...anchors.map(a => a.top)) - height * 2), bottom = Math.min(image.height, Math.max(...anchors.map(a => a.bottom)) + height * 2.5);
    const priceWords = source.rows.flatMap(row => row.words).filter(w => w.left - 24 > left && w.top - 24 >= top && w.top - 24 < bottom && moneyTokens(w.text).length && !w.text.includes('%'));
    if (priceWords.length >= 2) {
      left = Math.max(left, Math.min(...priceWords.map(w => w.left - 24)) - height);
      right = Math.min(image.width, Math.max(...priceWords.map(w => w.left + w.width - 24)) + height * .6);
    }
    // Read the whole compact summary again so short labels lost in page OCR
    // (especially Tax) can be recovered from pixels, not guessed from arithmetic.
    const bandRect = { left: Math.max(0, Math.min(...anchors.map(a => a.left)) - height * .6), right,
      top: Math.max(0, Math.min(...anchors.map(a => a.top)) - height), bottom: Math.min(image.height, Math.max(...anchors.map(a => a.bottom)) + height * 1.2) };
    const band = crop(image, bandRect), scale = Math.min(4, Math.max(.3, 40 / height));
    for (const variant of ['gray', 'binary', 'contrast']) {
      let patch = resize(band, Math.max(1, Math.round(band.width * scale)), Math.max(1, Math.round(band.height * scale)));
      if (variant === 'binary') patch = binarize(patch);
      if (variant === 'contrast') patch = normalizeLighting(patch);
      const read = await recognizePixels(border(patch, 16), 6, { layout: true });
      const parsed = parse(read.rawText);
      const rows = new Map();
      for (const line of read.tsv.split('\n').slice(1)) {
        const c = line.split('\t'); if (+c[0] !== 5 || !c[11] || +c[10] < 30) continue;
        const key = c.slice(1, 5).join(':');
        if (!rows.has(key)) rows.set(key, { words: [] });
        rows.get(key).words.push({ text: c.slice(11).join('\t'), confidence: +c[10], left: (+c[6] - 16) / scale + bandRect.left + 24,
          top: (+c[7] - 16) / scale + bandRect.top + 24, width: +c[8] / scale, height: +c[9] / scale });
      }
      const confidence = Object.fromEntries(['total', 'tax', 'subtotal'].map(field => {
        const words = [...rows.values()].flatMap(row => row.words).filter(w => moneyTokens(w.text).some(t => t.cents === Math.round(parsed[field] * 100)));
        return [field, words.length ? Math.max(...words.map(w => w.confidence)) : read.confidence];
      }));
      documents.push({ ...parsed, confidence: read.confidence, fieldConfidence: confidence, pass: `band:${source.pass.split(':')[0]}:${variant}`,
        _fieldReadings: ['total', 'tax', 'subtotal'].filter(f => parsed[f] !== null).map(type => ({ type, support: 1, cost: .3, confidence: confidence[type], text: parsed.evidence[type]?.rawLine })) });
      for (const anchor of headingAnchors([...rows.values()])) if (['total', 'tax', 'subtotal'].includes(anchor.type) && !anchors.some(a => a.type === anchor.type && Math.abs(a.center - anchor.center) < height * .6)) anchors.push(anchor);
    }
    anchors.sort((a, b) => a.center - b.center);
    const rect = { left, right, top, bottom };
    const percentages = source.rows.flatMap(row => row.words.filter(word => word.text.includes('%')).map(word => ({ left: word.left - 24, right: word.left + word.width - 24, top: word.top - 24, bottom: word.top + word.height - 24 })));
    const regions = amountRegions(image, rect, height).filter(region => !percentages.some(rate => Math.min(region.right, rate.right) - Math.max(region.left, rate.left) > Math.min(region.right - region.left, rate.right - rate.left) * .5 && Math.abs(region.center - (rate.top + rate.bottom) / 2) < height));
    const aligned = alignAmounts(anchors, regions);
    const cache = new Map();
    for (const { anchor, region, cost, alignmentScore } of aligned) {
      if (anchor.type === 'payment') continue;
      if (!cache.has(region.i)) cache.set(region.i, await readAmount(image, region, recognizePixels));
      for (const value of cache.get(region.i).slice(0, 3)) evidence.push({ ...value, type: anchor.type, rank: anchor.rank, aggregate: anchor.aggregate, label: anchor.label, pass: `heading:${source.pass.split(':')[0]}`, rawLine: `${anchor.label}: ${value.text}`, rect: region, labelRect: { left: anchor.left, top: anchor.top, right: anchor.right, bottom: anchor.bottom }, spatialCost: cost, alignmentScore });
    }
    for (const alignment of [...new Set(aligned.map(a => a.alignment))]) {
      let beams = [{ lines: [], readings: [], score: 0 }];
      for (const { anchor, region, cost } of aligned.filter(a => a.alignment === alignment)) {
        if (anchor.type === 'payment') continue;
        const values = cache.get(region.i).slice(0, 2);
        if (!values.length) continue;
        beams = beams.flatMap(beam => values.map(value => ({ lines: [...beam.lines, `${anchor.label}: ${value.text}`],
          readings: [...beam.readings, { ...value, type: anchor.type, label: anchor.label, rect: region, cost }],
          score: beam.score + value.support * 2 + value.confidence / 20 - cost * 3 })))
          .sort((a, b) => b.score - a.score).slice(0, 8);
      }
      for (const beam of beams) if (beam.lines.length) {
        const result = parse(beam.lines.join('\n'));
        documents.push({ ...result, confidence: beam.readings.reduce((sum, r) => sum + r.confidence, 0) / beam.readings.length,
          pass: `heading:${source.pass.split(':')[0]}:${alignment}`, fieldConfidence: Object.fromEntries(beam.readings.map(r => [r.type, r.confidence])),
          _fieldReadings: beam.readings, _alignmentScore: beam.score });
      }
    }
    diagnostics.push({ pass: source.pass, anchors, regions, aligned: aligned.map(a => ({ label: a.anchor.label, type: a.anchor.type, region: a.region, cost: a.cost })) });
  }
  return { evidence, diagnostics, documents };
}

export function selectFinancialFields(attempts, current) {
  const pools = {};
  for (const field of ['total', 'tax', 'subtotal']) {
    const candidates = [];
    for (const a of attempts) {
      if (a[field] === null || a[field] === undefined) continue;
      const confidence = a.fieldConfidence?.[field] ?? a.confidence;
      if (confidence < 25) continue;
      const observed = a._fieldReadings?.filter(r => r.type === field) || [];
      const support = observed.length ? Math.max(...observed.map(r => r.support)) : 1;
      const spatial = observed.length ? Math.min(...observed.map(r => r.cost)) : .5;
      const rawEvidence = a.evidence[field];
      const rank = Array.isArray(rawEvidence) ? Math.max(...rawEvidence.map(e => e.rank || 4)) : rawEvidence?.rank || 4;
      const family = a.pass.startsWith('heading:') ? a.pass.split(':').slice(0, 2).join(':') : a.pass.split(':')[0];
      const score = confidence / 12 + Math.min(2, support) * 1.5 - spatial * 3 + rank * .6;
      candidates.push({ cents: Math.round(a[field] * 100), confidence, score, source: a, evidence: rawEvidence, family });
    }
    pools[field] = [...new Set(candidates.map(c => c.cents))].map(cents => {
      const matches = candidates.filter(c => c.cents === cents).sort((a, b) => b.score - a.score);
      const independent = new Set(matches.map(c => c.family));
      return { ...matches[0], score: matches[0].score + Math.min(4, independent.size - 1), support: independent.size };
    }).sort((a, b) => b.score - a.score).slice(0, 8);
    if (!pools[field].length) pools[field] = [null];
  }
  let best = null;
  for (const total of pools.total) for (const tax of pools.tax) for (const subtotal of pools.subtotal) {
    let score = (total?.score || 0) + (tax?.score || 0) + (subtotal?.score || 0);
    const context = total?.source || current;
    if (total && tax && subtotal) {
      const extras = Math.round(((context.tip || current.tip || 0) + (context.serviceCharge || current.serviceCharge || 0) - Math.abs(context.discount || current.discount || 0)) * 100);
      const delta = Math.abs(total.cents - subtotal.cents - tax.cents - extras);
      score += delta <= 1 ? 24 : -8;
    }
    if (total && tax && total.cents > 0 && tax.cents >= total.cents) score -= 25;
    else if (total && tax && total.cents > 0 && tax.cents > total.cents * .5) score -= 12;
    if (total && subtotal && total.cents > 0 && subtotal.cents > total.cents * 1.5) score -= 12;
    if (!best || score > best.score) best = { total, tax, subtotal, score };
  }
  return best;
}

export async function recognizeDates(attempts, recognizePixels, options) {
  const evidence = [], regions = new Set();
  for (const a of attempts) {
    if (!a._rows || !a._image) continue;
    for (const row of a._rows) {
      const likely = row.words.filter(w => /\d.*[-/]\d.*[-/]\d|\d+\.\d+\.\d+/.test(w.text) || /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[.\s'-]*\d/i.test(w.text));
      if (!likely.length) continue;
      const key = `${a._image.width}:${Math.round(row.top / 10)}:${Math.round(row.left / 10)}`;
      if (regions.has(key) || regions.size >= 10) continue;
      regions.add(key);
      const image = a._fieldImage || a._image;
      const h = Math.max(...likely.map(w => w.height));
      const rect = { left: Math.max(0, Math.min(...likely.map(w => w.left)) - 24 - h * .3), right: Math.min(image.width, Math.max(...likely.map(w => w.left + w.width)) - 24 + h * .3),
        top: Math.max(0, Math.min(...likely.map(w => w.top)) - 24 - h * .15), bottom: Math.min(image.height, Math.max(...likely.map(w => w.top + w.height)) - 24 + h * .15) };
      const patch = crop(image, rect), scale = 48 / patch.height;
      for (const binary of [false, true]) {
        let scaled = resize(patch, Math.max(1, Math.round(patch.width * scale)), 48);
        if (binary) scaled = binarize(scaled);
        const read = await recognizePixels(border(scaled, 16), 7, { layout: false });
        const dates = extractDates([read.rawText.trim()], options.dateOrder);
        for (const date of dates) if (date.value && read.confidence >= 40) evidence.push({ ...date, confidence: read.confidence, pass: `date:${a.pass.split(':')[0]}`, rect });
      }
    }
  }
  return evidence;
}
