const MONEY = /(?:[$£€¥₩₱元円]\s*)?(-?\d{1,3}(?:[ ,.]\d{3})*[.,]\d{2}|-?\d+[.,]\d{2}|-?[.,]\d{2})\s*(?:[$£€¥₩₱元円]|(?:USD|CAD|AUD|NZD|GBP|EUR|JPY|CNY|RMB|KRW|MXN|PHP|INR))?/gi;
const PAYMENT = /\b(?:cash|tender(?:ed)?|change|visa|mastercard|amex|payment|paid|credit|debit|cashback|savings?|discount|suggested|recommended)\b/i;
const TAX_ID = /\b(?:tax|vat|gst|hst)\s*(?:id|number|no\.?|reg(?:istration)?)\b/i;

export function describeCurrency(code, symbol) {
  const currency = code || ({ '£': 'GBP', '€': 'EUR', '₩': 'KRW', '₱': 'PHP', '元': 'CNY', '円': 'JPY' })[symbol] || null;
  const currencyFamily = ({ USD: 'dollar', CAD: 'dollar', AUD: 'dollar', NZD: 'dollar', GBP: 'pound', EUR: 'euro', JPY: 'yen', CNY: 'yuan', KRW: 'won', PHP: 'peso', MXN: 'peso' })[currency] ||
    ({ '$': 'dollar', '£': 'pound', '€': 'euro', '¥': 'yen-or-yuan', '₩': 'won', '₱': 'peso', '元': 'yuan', '円': 'yen' })[symbol] || null;
  return { currency, currencySymbol: symbol || null, currencyFamily };
}

export function moneyTokens(text) {
  const found = [];
  for (const match of text.matchAll(MONEY)) {
    // Do not interpret a date, percentage, or substring of a longer number as money.
    if (/[\da-z.,/]/i.test(text[match.index - 1] || '') || /^\s*%/.test(text.slice(match.index + match[0].length))) continue;
    if (/[\d.,]/.test(text[match.index + match[0].length] || '')) continue;
    if (/^-?[.,]/.test(match[1]) && /[a-z]/i.test(text[match.index - 1] || '')) continue;
    const number = match[1], decimal = number.at(-3);
    let cents = Number(number.slice(0, -3).replace(/[ ,.]/g, '') + number.slice(-2));
    if (!Number.isSafeInteger(cents)) continue;
    const prefix = text.slice(0, match.index).trimEnd(), suffix = text.slice(match.index + match[0].length).trimStart();
    const parentheses = prefix.endsWith('(') && suffix.startsWith(')');
    if (prefix.endsWith('(') !== suffix.startsWith(')')) continue;
    const minus = prefix.endsWith('-') || /^-\s*$/.test(suffix);
    if ((minus || parentheses) && cents < 0) continue;
    if (minus || parentheses) cents = -Math.abs(cents);
    found.push({ cents, index: match.index, end: match.index + match[0].length, text: match[0], decimal });
  }
  // Explicit yen/yuan/won signs also permit whole-unit prices. Never insert a
  // decimal into an OCR digit string for dollar/pound/euro/peso amounts.
  for (const m of text.matchAll(/(?:([¥₩元円])\s*|\b(JPY|KRW)\s+)(-?\d[\d,]*)|(-?\d[\d,]*)\s*([元円])/gi)) {
    if (found.some(t => m.index < t.end && m.index + m[0].length > t.index)) continue;
    if (/[\d.,]/.test(text[m.index + m[0].length] || '')) continue;
    const units = Number((m[3] || m[4]).replace(/,/g, '')), cents = units * 100;
    if (Number.isSafeInteger(cents)) found.push({ cents, index: m.index, end: m.index + m[0].length, text: m[0], decimal: null });
  }
  found.sort((a, b) => a.index - b.index);
  return found;
}

export function classifyLabel(text) {
  // Correct only common OCR confusions in field LABELS, never arbitrary words or amounts.
  const label = text.toLowerCase().replace(/\bsub\s*[-.]?\s*t[o0]ta[l1i]\b/g, 'subtotal')
    .replace(/\bs?u[b8]t[o0]ta[|!\]l1i]?(?=\s|:|$)/g, 'subtotal')
    .replace(/\b(t[o0]ta|sub\s*t[o0]ta)[|!\]](?=\s|:|$)/g, '$1l')
    .replace(/\b[t1il][o0]ta[l1i]\b/g, 'total').replace(/\bta[x×]\b/g, 'tax')
    .replace(/\bsub\s*[/ -]\s*tt?l\b/g, 'subtotal').replace(/^\s*(?:totl|tl)\b/g, 'total')
    .replace(/^\s*txtl\b/g, 'tax');
  if (TAX_ID.test(label)) return null;
  if (/\b(?:sub|sbt|sbt[l1]|sbtl)\s*(?:w\s*\/|with)\s*tax\b/.test(label)) return null;
  if (/\bh\s*\.\s*t\s*\.?\s*tva\b/.test(label)) return null; // French pre-tax amount, not VAT.
  if (/\b(?:subtotal|sub\s+total|net\s+total)\b/.test(label)) return { type: 'subtotal', rank: 4 };
  if (/\b(?:total\s+(?:(?:sales|state|local)\s+)?tax(?:es)?|tax\s+total)\b/.test(label)) return { type: 'tax', rank: 5, aggregate: true };
  if (/\b(?:(?:sales|state|local|city|county)\s+)?(?:tax(?:es)?|vat|tva|iva|gst|hst|pst|qst)(?=\b|\d)/.test(label)) return { type: 'tax', rank: 4 };
  if (/\bdiscount\b/.test(label) && !/\b(?:suggested|prior|before)\b/.test(label)) return { type: 'discount', rank: 2 };
  if (/\b(?:suggested|recommended|savings?|saved|discount|items?|qty|quantity|tender|payments?|change)\b/.test(label)) return null;
  if (/\bgrand\s+total\b/.test(label)) return { type: 'total', rank: 6 };
  if (/\b(?:check|receipt|sale)\s+(?:total|[f1]otal)\b/.test(label)) return { type: 'total', rank: 5 };
  if (/\btotal\s+paid\b/.test(label)) return { type: 'total', rank: 4 };
  if (/\btotal(?:e)?\b/.test(label) && !PAYMENT.test(label)) return { type: 'total', rank: 4 };
  if (/\b(?:amount|amt)\s+due\b/.test(label)) return { type: 'total', rank: 3 };
  if (/\bbalance\s+due\b/.test(label)) return { type: 'total', rank: 2 };
  if (/^\W*(?:automatic\s+|voluntary\s+|additional\s+)?(?:tip|gratuity|grat)\b/.test(label)) return { type: 'tip', rank: 2 };
  if (/\b(?:service|processing|delivery|carry\s*out)\s*(?:charge|fees?)\b|\bsurcharge\b/.test(label)) return { type: 'serviceCharge', rank: 2 };
  return null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function validDate(year, month, day) {
  if (year < 1900 || year > 2199 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCMonth() === month - 1 && d.getUTCDate() === day ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : null;
}
export function extractDates(lines, dateOrder) {
  const candidates = [];
  for (const [index, line] of lines.entries()) {
    const patterns = [
      /\b(20\d{2}|19\d{2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})\b/g,
      /\b(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{4}|\d{2})\b/g,
      /\b(\d{1,2})[-\s/]+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[-\s/,'’]+(\d{4}|\d{2})\b/gi,
      /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[.\s-]*(\d{1,2})(?:st|nd|rd|th)?[,\s'’.-]+(\d{4}|\d{2})\b/gi,
    ];
    for (let p = 0; p < patterns.length; p++) for (const m of line.matchAll(patterns[p])) {
      let year, month, day, ambiguous = false;
      if (p === 0) { year = +m[1]; month = +m[2]; day = +m[3]; }
      else if (p === 1) {
        year = +m[3];
        const a = +m[1], b = +m[2];
        ambiguous = a <= 12 && b <= 12 && a !== b && !dateOrder;
        if (a > 12 || dateOrder === 'DMY') { day = a; month = b; }
        else { month = a; day = b; }
      } else if (p === 2) { year = +m[3]; month = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1; day = +m[1]; }
      else { year = +m[3]; month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1; day = +m[2]; }
      if (year < 100) year += year < 70 ? 2000 : 1900;
      const iso = validDate(year, month, day);
      if (!iso) continue;
      const rank = (/\b(?:date|created|sale|purchase)\b/i.test(line) ? 3 : 1) - (/\b(?:exp|expiry|expires|valid|survey)\b/i.test(line) ? 10 : 0);
      candidates.push({ value: ambiguous ? null : iso, raw: m[0], ambiguous, rank, lineNumber: index + 1, rawLine: line });
    }
  }
  candidates.sort((a, b) => b.rank - a.rank || a.lineNumber - b.lineNumber);
  return candidates.filter(c => c.rank >= 0);
}

export function extractMerchant(lines) {
  const candidates = [];
  for (let i = 0; i < Math.min(lines.length, 35); i++) {
    const raw = lines[i];
    let text = raw.replace(/^\s*welcome\s+to\s+/i, '').replace(/^[^\p{L}\d]+|[^\p{L}\d.!'’&)-]+$/gu, '').trim();
    text = text.replace(/\s+#?\d{3,}\s*$/, '').trim();
    const descriptor = lines[i + 1]?.trim();
    if (descriptor && /^(?:(?:japanese|indian|mexican|chinese|family|seafood|italian|american|steak|steakhouse)\s+)+(?:restaurant|cuisine|kitchen|grill|house)(?:\s*&\s*bar)?$/i.test(descriptor)) text += ' ' + descriptor;
    const letters = (text.match(/\p{L}/gu) || []).length;
    if (letters < 3 || letters / text.length < .55 || text.length > 75) continue;
    if (classifyLabel(text) || PAYMENT.test(text) || /\b(?:server|cashier|table|order|station|guests?|check|receipt|reprint|pickup|dine|take\s*out|thank|welcome|customer|merchant\s+copy|survey|chance|win|visit|download|mobile|ordering|approval|auth|account|tel|phone|fax|www|http|date|time)\b/i.test(text)) continue;
    if (/\d{1,2}:\d{2}|\d{1,4}[-/]\d{1,2}[-/]\d{2,4}|\d{3}[-). ]+\d{3}|\b[A-Z]{2}\s+\d{5}\b/.test(text)) continue;
    if (/\b(?:street|road|avenue|blvd|boulevard|hwy|highway|suite|zip)\b/i.test(text) || moneyTokens(text).length) continue;
    if (/^\d+\s/.test(text) && !/\b(?:restaurant|cafe|tavern|bar|grill|market|diner|coffee|pizza)\b/i.test(text)) continue;
    if (/^[\p{L} ]+,\s*[A-Z]{2}\b/u.test(text)) continue;
    let score = 40 - i * 1.3;
    if (letters >= 5 && /^(.)\1{3,}$/i.test(text.replace(/[^a-z]/gi, ''))) score -= 35;
    if (text.split(/\s+/).some(w => w.length >= 5 && !/[aeiouy]/i.test(w))) score -= 20;
    if (/\b(?:restaurant|cafe|café|coffee|pizza|grill|bar|market|deli|sushi|bakery|kitchen|diner|steak|seafood|bistro|pub|shop)\b/i.test(text)) score += 8;
    if (lines[i + 1] && /^\s*\d+\s+\S/.test(lines[i + 1])) score += 15;
    if (text === text.toUpperCase() && letters > 5) score += 3;
    if (/[|\\~_=<>]/.test(text)) score -= 15;
    if (letters < 5) score -= 15;
    candidates.push({ value: text, score, lineNumber: i + 1, rawLine: raw });
  }
  return candidates.sort((a, b) => b.score - a.score);
}

export function parse(rawText, options = {}) {
  if (typeof rawText !== 'string') throw new TypeError('Receipt text must be a string.');
  if (rawText.length > 100000) throw new RangeError('Receipt text exceeds 100000 characters.');
  if (options.dateOrder !== undefined && !['MDY', 'DMY'].includes(options.dateOrder)) throw new RangeError('dateOrder must be MDY or DMY.');
  const warnings = [], lines = rawText.split(/\r\n|\n|\r/).map(line => line.trim()
    .replace(/(\d)\s+([.,])\s*(\d{2})(?!\d)/g, '$1$2$3').replace(/(\d[.,])\s+(\d{2})(?!\d)/g, '$1$2'));
  const result = { rawText, merchant: null, date: null, dateRaw: null, currency: null, currencySymbol: null, currencyFamily: null,
    total: null, subtotal: null, tax: null, tip: null, serviceCharge: null, discount: null, items: [], taxLines: [], warnings, needsReview: true, evidence: {} };
  const warn = text => { if (!warnings.includes(text)) warnings.push(text); };
  const candidates = { total: [], subtotal: [], tax: [], tip: [], serviceCharge: [], discount: [] };
  let summaryStarted = false, includedTax = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line.length > 1000) { warn(`Line ${index + 1} exceeds 1000 characters and was skipped.`); continue; }
    if (!line || TAX_ID.test(line)) continue;
    const tokens = moneyTokens(line), label = classifyLabel(line);
    if (label) {
      summaryStarted = true;
      let amount = tokens.at(-1), amountLine = index;
      if (label.type === 'tax' && tokens.length >= 3) {
        const [net, tax, gross] = tokens.slice(-3);
        if (Math.abs(net.cents + tax.cents - gross.cents) <= 1) amount = tax;
      }
      // Standalone labels and vertically aligned amounts are common on till receipts.
      if (!amount && index + 1 < lines.length && /^\s*[$£€¥₩₱元円\d(]/.test(lines[index + 1]) && !classifyLabel(lines[index + 1])) {
        const next = moneyTokens(lines[index + 1]);
        if (next.length === 1 && /^[\s$£€¥₩₱元円\d.,()=-]+$/.test(lines[index + 1])) { amount = next[0]; amountLine++; }
      }
      if (!amount) continue;
      // A rate is not a tax amount; moneyTokens already excludes percentages.
      const evidence = { ...label, cents: amount.cents, lineNumber: index + 1, rawLine: lines.slice(index, amountLine + 1).join('\n') };
      candidates[label.type].push(evidence);
      if (label.type === 'tax' && /\b(?:incl(?:uded|usive|uding)?|dont)\b/i.test(line)) includedTax = true;
    } else if (!summaryStarted && tokens.length && !PAYMENT.test(line) && !/\b(?:tel|phone|date|time|order|check|table|server)\b/i.test(line)) {
      const token = tokens.at(-1), description = line.slice(0, token.index).trim();
      if (/[a-z]/i.test(description)) result.items.push({ description, quantity: null, amount: token.cents / 100, lineNumber: index + 1, rawLine: line });
    }
  }
  function select(type) {
    const list = candidates[type].toSorted((a, b) => b.rank - a.rank || b.lineNumber - a.lineNumber);
    if (!list.length) return null;
    // Some receipts print a second, tax-inclusive "subtotal". Keep the actual
    // pre-tax subtotal when the immediately observed tax and total corroborate it.
    if (type === 'subtotal') {
      const total = selected.total?.cents;
      const tax = candidates.tax.filter(c => !c.aggregate).reduce((sum, c) => sum + c.cents, 0);
      const matched = list.find(c => total !== undefined && Math.abs(c.cents + tax - total) <= 1);
      if (matched) return matched;
    }
    const sameRank = list.filter(c => c.rank === list[0].rank);
    if (new Set(sameRank.map(c => c.cents)).size > 1) warn(`Ambiguous ${type}: conflicting explicitly labelled amounts.`);
    return list[0];
  }
  const selected = {};
  for (const field of ['total', 'tip', 'serviceCharge', 'discount', 'subtotal']) {
    selected[field] = select(field);
    if (selected[field]) { result[field] = selected[field].cents / 100; result.evidence[field] = selected[field]; }
  }
  const uniqueTax = [...new Map(candidates.tax.map(c => [c.rawLine.toLowerCase().replace(/\s+/g, ' '), c])).values()];
  const aggregate = uniqueTax.filter(c => c.aggregate).at(-1);
  let taxes = aggregate ? [aggregate] : uniqueTax;
  if (!aggregate && uniqueTax.length > 1) {
    // An overall tax after per-seat taxes is not an additional component.
    const last = uniqueTax.at(-1), earlier = uniqueTax.slice(0, -1);
    if (earlier.reduce((sum, t) => sum + t.cents, 0) === last.cents) taxes = [last];
    const expected = selected.total && selected.subtotal ? selected.total.cents - selected.subtotal.cents - (selected.tip?.cents || 0) - (selected.serviceCharge?.cents || 0) + Math.abs(selected.discount?.cents || 0) : null;
    const matching = uniqueTax.filter(t => t.cents === expected);
    if (matching.length && uniqueTax.every(t => t.cents === expected)) taxes = [matching.at(-1)];
  }
  if (taxes.length) {
    const cents = taxes.reduce((sum, t) => sum + t.cents, 0);
    if (Number.isSafeInteger(cents)) {
      result.tax = cents / 100;
      result.taxLines = taxes.map(t => ({ label: t.rawLine, amount: t.cents / 100, lineNumber: t.lineNumber, rawLine: t.rawLine }));
      result.evidence.tax = taxes;
    }
  }
  const merchants = extractMerchant(lines);
  if (merchants.length) { result.merchant = merchants[0].value; result.evidence.merchant = merchants[0]; }
  const dates = extractDates(lines, options.dateOrder);
  if (dates.length) {
    result.date = dates[0].value; result.dateRaw = dates[0].raw; result.evidence.date = dates[0];
    if (dates[0].ambiguous) warn('Ambiguous day/month order: set dateOrder to MDY or DMY; date left null.');
    if (new Set(dates.filter(d => d.value).map(d => d.value)).size > 1) warn('Multiple receipt dates detected; verify selected date.');
  }
  const codes = [...new Set((rawText.match(/\b(?:USD|CAD|AUD|NZD|GBP|EUR|EURO|JPY|CNY|RMB|KRW|MXN|PHP|INR)\b/g) || []).map(code => code === 'EURO' ? 'EUR' : code === 'RMB' ? 'CNY' : code))];
  const symbols = [...new Set(lines.flatMap(line => moneyTokens(line).flatMap(token => token.text.match(/[$£€¥₩₱元円]/g) || [])))];
  if (symbols.length === 1) result.currencySymbol = symbols[0];
  if (codes.length === 1) result.currency = codes[0];
  else if (symbols.length === 1 && symbols[0] === '£') result.currency = 'GBP';
  else if (symbols.length === 1 && symbols[0] === '€') result.currency = 'EUR';
  else if (symbols.length === 1 && symbols[0] === '₩') result.currency = 'KRW';
  else if (symbols.length === 1 && symbols[0] === '₱') result.currency = 'PHP';
  else if (symbols.length === 1 && symbols[0] === '元') result.currency = 'CNY';
  else if (symbols.length === 1 && symbols[0] === '円') result.currency = 'JPY';
  result.currencyFamily = describeCurrency(result.currency, result.currencySymbol).currencyFamily;
  if (codes.length > 1 || symbols.length > 1) warn('Multiple currencies detected; verify currency and amounts.');
  if (result.currencySymbol === '$' && !result.currency) warn('Dollar symbol is ambiguous; currency code not inferred.');
  if (result.currencySymbol === '¥' && !result.currency) warn('Yen/yuan symbol is ambiguous; currency code not inferred.');
  for (const field of ['merchant', 'date', 'total', 'tax']) if (result[field] === null) warn(`Missing ${field}: no usable explicit value found.`);
  if (includedTax) warn('Included tax detected; subtotal may already include tax.');
  if (!includedTax && result.total !== null && result.subtotal !== null && result.tax !== null) {
    const delta = Math.abs(Math.round(result.total * 100) - Math.round(result.subtotal * 100) - Math.round(result.tax * 100) - Math.round((result.tip || 0) * 100) - Math.round((result.serviceCharge || 0) * 100) + Math.round(Math.abs(result.discount || 0) * 100));
    result.arithmeticMatches = delta <= 1;
    if (delta > 1) warn('Subtotal + tax + tip + fees - discount mismatch with total; extracted values were not changed.');
  }
  return result;
}

export function scoreResult(result) {
  // Generic evidence-based selection; no knowledge of merchants, filenames, or expected answers.
  if (!result.rawText.trim()) return -100;
  return (result.confidence || 0) / 8 + (result.total !== null ? 12 : 0) + (result.tax !== null ? 7 : 0) +
    (result.subtotal !== null ? 3 : 0) + (result.merchant ? 3 : 0) + (result.dateRaw ? 3 : 0) +
    (result.arithmeticMatches === true ? 10 : result.arithmeticMatches === false ? -12 : 0) +
    (result.tax !== null && result.total !== null && result.total >= 0 && result.tax > result.total ? -20 : 0) +
    Math.min(3, result.rawText.replace(/[^a-z]/gi, '').length / 150) - result.warnings.filter(w => /Ambiguous|conflicting/.test(w)).length * 2;
}
