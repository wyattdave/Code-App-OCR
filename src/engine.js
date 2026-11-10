import { gunzipSync } from 'fflate';

export const info = Object.freeze({
  version: '1.2.0', coreVersion: '3.0.1', tesseractVersion: '4.1.1',
  engine: 'asm.js (ordinary JavaScript)', language: 'eng', model: 'tessdata_fast 4.1.0 English',
  webAssembly: false, workers: false, runtimeDownloads: false, initialHeapMiB: 128,
});
let engine = null, observer = null;
export function setObserver(callback) { observer = callback; }
function report(status, progress) { try { observer?.({ status, progress }); } catch { /* Observer errors cannot abort OCR. */ } }

export async function initialize() {
  if (engine) return engine;
  report('initializing', 0);
  const { value: module } = await new Promise((resolve, reject) => {
    try {
      createReceiptCore({ INITIAL_MEMORY: info.initialHeapMiB * 1024 * 1024, print: () => {}, printErr: () => {},
        onAbort: () => reject(new Error('JavaScript OCR engine aborted during initialization.')),
        TesseractProgress: n => report('recognizing', Math.max(0, Math.min(1, (n - 30) / 70))),
      }).then(value => resolve({ value }));
    } catch (error) { reject(error); }
  });
  let api;
  try {
    module.FS.writeFile('/eng.traineddata', gunzipSync(Uint8Array.from(atob(__EMBEDDED_MODEL__), c => c.charCodeAt(0))));
    api = new module.TessBaseAPI();
    if (api.Init('/', 'eng', 1) !== 0) throw new Error('Could not initialize the embedded English LSTM model.');
    api.SetVariable('preserve_interword_spaces', '1');
    module.FS.unlink('/eng.traineddata');
    engine = { module, api };
    report('ready', 1);
    return engine;
  } catch (error) { if (api) { api.End(); module.destroy(api); } throw error; }
}

function readText(module, ptr, limit) {
  if (!ptr) return '';
  try {
    const data = module.HEAPU8.subarray(ptr, ptr + limit + 1), end = data.indexOf(0);
    if (end < 0) throw new RangeError('OCR text exceeds its size limit.');
    return new TextDecoder().decode(data.subarray(0, end));
  } finally { module._free(ptr); }
}

// Internal API: callers must serialize access. All pixels/model data are local.
export async function recognizePixels(image, mode, { alphabet = '', layout = true } = {}) {
  // Yield between local passes so progress and the Code App UI can repaint.
  await new Promise(resolve => setTimeout(resolve, 0));
  const { module, api } = await initialize();
  const ptr = module._malloc(image.pixels.length);
  if (!ptr) throw new Error('Insufficient memory for the receipt image.');
  try {
    api.SetVariable('tessedit_char_whitelist', alphabet);
    module.HEAPU8.set(image.pixels, ptr);
    api.SetPageSegMode(mode);
    api.SetImage(ptr, image.width, image.height, 1, image.width);
    api.SetSourceResolution(300);
    if (api.Recognize(null) !== 0) throw new Error('Tesseract could not recognize this image.');
    const rawText = readText(module, module._emscripten_bind_TessBaseAPI_GetUTF8Text_0(api.ptr), 100000);
    const confidence = api.MeanTextConf();
    const tsv = layout ? readText(module, module._emscripten_bind_TessBaseAPI_GetTSVText_1(api.ptr, 0), 1000000) : '';
    return { rawText, confidence, tsv };
  } finally {
    try { api.SetVariable('tessedit_char_whitelist', ''); api.Clear(); }
    finally { module._free(ptr); }
  }
}

export function disposeEngine() {
  if (engine) { try { engine.api.End(); engine.module.destroy(engine.api); } finally { engine = null; } }
}
