'use strict';

/* ============================================================
   Estado global
   ============================================================ */
const state = {
  ctx: null,
  originalBuffer: null,   // AudioBuffer tal cual se cargó
  currentBuffer: null,    // AudioBuffer activo (post tempo/tono si se renderizó)
  fileName: '',
  sourceNode: null,
  analyser: null,
  playing: false,
  playStartTime: 0,
  playStartOffset: 0,
  raf: null,
  stems: {} // { vocals, instrumental, bass, drums } -> AudioBuffer
};

function getCtx(){
  if (!state.ctx) state.ctx = new (window.AudioContext || window.webkitAudioContext)();
  return state.ctx;
}

/* ============================================================
   Carga de archivo
   ============================================================ */
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const browseBtn = document.getElementById('browseBtn');
const newFileBtn = document.getElementById('newFileBtn');
const waveformWrap = document.getElementById('waveformWrap');
const trackNameEl = document.getElementById('trackName');
const statusPill = document.getElementById('statusPill');
const consoleSection = document.getElementById('consoleSection');
const stemsSection = document.getElementById('stemsSection');

browseBtn.addEventListener('click', (e)=>{ e.stopPropagation(); fileInput.click(); });
dropzone.addEventListener('click', ()=> fileInput.click());
newFileBtn.addEventListener('click', ()=>{
  waveformWrap.hidden = true;
  dropzone.hidden = false;
  consoleSection.hidden = true;
  stemsSection.hidden = true;
  stopPlayback();
});

['dragenter','dragover'].forEach(evt=>{
  dropzone.addEventListener(evt, (e)=>{ e.preventDefault(); dropzone.classList.add('dragover'); });
});
['dragleave','drop'].forEach(evt=>{
  dropzone.addEventListener(evt, (e)=>{ e.preventDefault(); dropzone.classList.remove('dragover'); });
});
dropzone.addEventListener('drop', (e)=>{
  const f = e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) loadFile(f);
});
fileInput.addEventListener('change', ()=>{
  if (fileInput.files[0]) loadFile(fileInput.files[0]);
});

async function loadFile(file){
  statusPill.textContent = 'cargando…';
  try{
    const arrBuf = await file.arrayBuffer();
    const ctx = getCtx();
    const audioBuffer = await ctx.decodeAudioData(arrBuf);
    state.originalBuffer = audioBuffer;
    state.currentBuffer = audioBuffer;
    state.fileName = file.name.replace(/\.[^.]+$/, '');
    state.stems = {};
    document.getElementById('stemGrid').hidden = true;
    document.getElementById('stemGrid').innerHTML = '';
    document.getElementById('exportMixBtn').disabled = true;

    trackNameEl.textContent = file.name;
    dropzone.hidden = true;
    waveformWrap.hidden = false;
    consoleSection.hidden = false;
    stemsSection.hidden = false;
    statusPill.textContent = `${audioBuffer.duration.toFixed(1)}s · ${audioBuffer.sampleRate}Hz · ${audioBuffer.numberOfChannels}ch`;
    statusPill.classList.add('active');
    drawWaveform(audioBuffer);
    updateTimeLabel(0, audioBuffer.duration);
  }catch(err){
    console.error(err);
    statusPill.textContent = 'no se pudo leer el audio';
  }
}

/* ============================================================
   Waveform
   ============================================================ */
const waveCanvas = document.getElementById('waveCanvas');
function drawWaveform(buffer, playedRatio){
  const dpr = window.devicePixelRatio || 1;
  const w = waveCanvas.clientWidth || 600;
  const h = 140;
  waveCanvas.width = w*dpr; waveCanvas.height = h*dpr;
  const g = waveCanvas.getContext('2d');
  g.scale(dpr,dpr);
  g.clearRect(0,0,w,h);

  const data = buffer.getChannelData(0);
  const samplesPerPx = Math.max(1, Math.floor(data.length / w));
  g.strokeStyle = '#4FE0C4';
  g.fillStyle = 'rgba(79,224,196,0.18)';
  const mid = h/2;
  g.beginPath();
  for (let x=0; x<w; x++){
    let min=1, max=-1;
    const start = x*samplesPerPx;
    for (let i=0;i<samplesPerPx;i++){
      const v = data[start+i] || 0;
      if (v<min) min=v;
      if (v>max) max=v;
    }
    g.moveTo(x, mid + min*mid*0.9);
    g.lineTo(x, mid + max*mid*0.9);
  }
  g.strokeStyle = '#4FE0C4';
  g.lineWidth = 1;
  g.stroke();

  if (playedRatio && playedRatio>0){
    g.fillStyle = 'rgba(255,106,43,0.18)';
    g.fillRect(0,0, w*playedRatio, h);
    g.strokeStyle = '#FF6A2B';
    g.beginPath();
    g.moveTo(w*playedRatio, 0);
    g.lineTo(w*playedRatio, h);
    g.stroke();
  }
}
window.addEventListener('resize', ()=>{ if (state.currentBuffer) drawWaveform(state.currentBuffer, playedRatioNow()); });

function playedRatioNow(){
  if (!state.playing || !state.currentBuffer) return 0;
  const elapsed = state.playStartOffset + (getCtx().currentTime - state.playStartTime);
  return Math.min(1, elapsed / state.currentBuffer.duration);
}

/* ============================================================
   Analyser (VU meter en vivo)
   ============================================================ */
const analyserCanvas = document.getElementById('analyserCanvas');
function drawAnalyser(){
  if (!state.playing || !state.analyser){
    const g = analyserCanvas.getContext('2d');
    g.clearRect(0,0,analyserCanvas.width, analyserCanvas.height);
    return;
  }
  const dpr = window.devicePixelRatio || 1;
  const w = analyserCanvas.clientWidth || 600;
  const h = 36;
  analyserCanvas.width = w*dpr; analyserCanvas.height = h*dpr;
  const g = analyserCanvas.getContext('2d');
  g.scale(dpr,dpr);
  g.clearRect(0,0,w,h);

  const bufferLength = state.analyser.frequencyBinCount;
  const dataArr = new Uint8Array(bufferLength);
  state.analyser.getByteFrequencyData(dataArr);

  const bars = 40;
  const step = Math.floor(bufferLength/bars);
  const barW = w/bars;
  for (let i=0;i<bars;i++){
    let sum=0;
    for (let j=0;j<step;j++) sum += dataArr[i*step+j];
    const avg = sum/step/255;
    const barH = avg*h;
    g.fillStyle = i/bars < 0.7 ? '#FF6A2B' : '#4FE0C4';
    g.fillRect(i*barW+1, h-barH, barW-2, barH);
  }
}

/* ============================================================
   Transporte (play / stop)
   ============================================================ */
const playBtn = document.getElementById('playBtn');
const stopBtn = document.getElementById('stopBtn');
const timeLabel = document.getElementById('timeLabel');

playBtn.addEventListener('click', ()=>{
  if (state.playing) pausePlayback(); else startPlayback();
});
stopBtn.addEventListener('click', stopPlayback);

function startPlayback(offset){
  const ctx = getCtx();
  if (ctx.state === 'suspended') ctx.resume();
  const buf = state.currentBuffer;
  if (!buf) return;
  const startOffset = offset != null ? offset : (state.playing ? 0 : (state._pauseOffset || 0));

  const src = ctx.createBufferSource();
  src.buffer = buf;
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  src.connect(analyser);
  analyser.connect(ctx.destination);
  src.start(0, startOffset);
  src.onended = ()=>{
    if (state.playing && (ctx.currentTime - state.playStartTime + state.playStartOffset) >= buf.duration - 0.05){
      stopPlayback();
    }
  };

  state.sourceNode = src;
  state.analyser = analyser;
  state.playing = true;
  state.playStartTime = ctx.currentTime;
  state.playStartOffset = startOffset;
  playBtn.textContent = '❚❚';
  loopUI();
}

function pausePlayback(){
  if (!state.playing) return;
  const ctx = getCtx();
  state._pauseOffset = state.playStartOffset + (ctx.currentTime - state.playStartTime);
  try{ state.sourceNode.stop(); }catch(e){}
  state.playing = false;
  playBtn.textContent = '▶';
  cancelAnimationFrame(state.raf);
  drawAnalyser();
}

function stopPlayback(){
  if (state.sourceNode){ try{ state.sourceNode.stop(); }catch(e){} }
  state.playing = false;
  state._pauseOffset = 0;
  playBtn.textContent = '▶';
  cancelAnimationFrame(state.raf);
  if (state.currentBuffer){ drawWaveform(state.currentBuffer, 0); updateTimeLabel(0, state.currentBuffer.duration); }
  drawAnalyser();
}

function loopUI(){
  if (!state.playing) return;
  const buf = state.currentBuffer;
  const elapsed = state.playStartOffset + (getCtx().currentTime - state.playStartTime);
  if (elapsed >= buf.duration){ stopPlayback(); return; }
  drawWaveform(buf, elapsed/buf.duration);
  updateTimeLabel(elapsed, buf.duration);
  drawAnalyser();
  state.raf = requestAnimationFrame(loopUI);
}

function fmtTime(s){
  s = Math.max(0,s);
  const m = Math.floor(s/60);
  const sec = Math.floor(s%60);
  return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}
function updateTimeLabel(elapsed, duration){
  timeLabel.textContent = `${fmtTime(elapsed)} / ${fmtTime(duration)}`;
}

/* ============================================================
   WSOLA — time-stretch clásico (preserva tono) + resample (cambia tono)
   ============================================================ */

function hannWindow(size){
  const w = new Float32Array(size);
  for (let i=0;i<size;i++) w[i] = 0.5 - 0.5*Math.cos(2*Math.PI*i/(size-1));
  return w;
}

// Estira/comprime en el tiempo un set de canales (Float32Array[]) por factor `alpha`
// alpha > 1 => salida más larga (más lenta), alpha < 1 => salida más corta (más rápida). El tono se preserva.
function wsolaStretch(channels, alpha, onProgress){
  const frameSize = 2048;
  const synHop = 512;
  const tolerance = 128;
  const corrLen = 256;
  const searchStep = 2;
  const window = hannWindow(frameSize);
  const inLen = channels[0].length;
  const outLen = Math.max(frameSize, Math.floor(inLen * alpha));
  const nCh = channels.length;

  const output = [];
  const normBuf = new Float32Array(outLen + frameSize);
  for (let c=0;c<nCh;c++) output.push(new Float32Array(outLen + frameSize));

  // señal mono de referencia para decidir el mejor desplazamiento
  const mono = new Float32Array(inLen);
  for (let i=0;i<inLen;i++){
    let s=0; for (let c=0;c<nCh;c++) s += channels[c][i];
    mono[i] = s/nCh;
  }

  function overlapAdd(anaPos, synPos){
    const end = Math.min(frameSize, inLen - anaPos, output[0].length - synPos);
    if (end <= 0) return;
    for (let c=0;c<nCh;c++){
      const chIn = channels[c];
      const chOut = output[c];
      for (let k=0;k<end;k++){
        chOut[synPos+k] += chIn[anaPos+k]*window[k];
      }
    }
    for (let k=0;k<end;k++) normBuf[synPos+k] += window[k];
  }

  let synPos = 0;
  let anaPosFloat = 0;
  overlapAdd(0, 0);
  let totalSteps = Math.ceil(outLen/synHop);
  let step = 0;

  while (synPos + synHop < outLen){
    synPos += synHop;
    anaPosFloat += synHop/alpha;
    let idealAna = Math.round(anaPosFloat);
    const searchStart = Math.max(0, idealAna - tolerance);
    const searchEnd = Math.min(inLen - frameSize - 1, idealAna + tolerance);

    let bestPos = Math.min(Math.max(idealAna,0), Math.max(inLen-frameSize-1,0));
    if (searchEnd > searchStart){
      let bestScore = -Infinity;
      const overlapLen = Math.min(corrLen, output[0].length - synPos);
      for (let cand = searchStart; cand <= searchEnd; cand += searchStep){
        let score = 0;
        for (let k=0;k<overlapLen;k++){
          score += normBuf[synPos+k] > 0 ? (output[0][synPos+k]) * mono[cand+k] : 0;
        }
        if (score > bestScore){ bestScore = score; bestPos = cand; }
      }
    }
    overlapAdd(bestPos, synPos);

    step++;
    if (onProgress && (step % 200 === 0)) onProgress(step/totalSteps*0.7);
  }

  // normalizar
  const result = [];
  for (let c=0;c<nCh;c++){
    const chOut = output[c];
    const norm = new Float32Array(outLen);
    for (let i=0;i<outLen;i++){
      norm[i] = normBuf[i] > 0.0001 ? chOut[i]/normBuf[i] : chOut[i];
    }
    result.push(norm);
  }
  return result;
}

// Re-muestrea (interp. lineal) para cambiar el tono; factor>1 sube el tono y acorta, factor<1 baja el tono y alarga
function resampleLinear(data, factor){
  const outLen = Math.max(1, Math.floor(data.length/factor));
  const out = new Float32Array(outLen);
  for (let i=0;i<outLen;i++){
    const srcPos = i*factor;
    const idx = Math.floor(srcPos);
    const frac = srcPos-idx;
    const s0 = data[idx] || 0;
    const s1 = data[idx+1] !== undefined ? data[idx+1] : s0;
    out[i] = s0 + (s1-s0)*frac;
  }
  return out;
}

async function renderTempoPitch(buffer, tempoPct, semitones, onProgress){
  const tempoRatio = tempoPct/100;              // >1 más rápido
  const pitchRatio = Math.pow(2, semitones/12);  // >1 más agudo
  const alpha = pitchRatio/tempoRatio;

  const nCh = buffer.numberOfChannels;
  const channels = [];
  for (let c=0;c<nCh;c++) channels.push(buffer.getChannelData(c));

  await yieldFrame();
  const stretched = wsolaStretch(channels, alpha, onProgress);
  await yieldFrame();

  const finalChannels = stretched.map(ch => resampleLinear(ch, pitchRatio));
  if (onProgress) onProgress(0.95);

  const ctx = getCtx();
  const outLen = finalChannels[0].length;
  const outBuffer = ctx.createBuffer(nCh, outLen, buffer.sampleRate);
  for (let c=0;c<nCh;c++) outBuffer.getChannelData(c).set(finalChannels[c]);
  if (onProgress) onProgress(1);
  return outBuffer;
}

function yieldFrame(){ return new Promise(r=> setTimeout(r,0)); }

/* ============================================================
   Controles de tempo / tono
   ============================================================ */
const tempoRange = document.getElementById('tempoRange');
const pitchRange = document.getElementById('pitchRange');
const tempoValue = document.getElementById('tempoValue');
const pitchValue = document.getElementById('pitchValue');
const renderBtn = document.getElementById('renderBtn');
const resetTempoBtn = document.getElementById('resetTempoBtn');
const exportMixBtn = document.getElementById('exportMixBtn');
const renderProgress = document.getElementById('renderProgress');
const renderProgressBar = document.getElementById('renderProgressBar');

tempoRange.addEventListener('input', ()=> tempoValue.textContent = tempoRange.value);
pitchRange.addEventListener('input', ()=> pitchValue.textContent = (pitchRange.value>0?'+':'')+pitchRange.value);

resetTempoBtn.addEventListener('click', ()=>{
  tempoRange.value = 100; pitchRange.value = 0;
  tempoValue.textContent = '100'; pitchValue.textContent = '0';
  state.currentBuffer = state.originalBuffer;
  exportMixBtn.disabled = true;
  stopPlayback();
  drawWaveform(state.currentBuffer, 0);
});

renderBtn.addEventListener('click', async ()=>{
  if (!state.originalBuffer) return;
  const tempoPct = Number(tempoRange.value);
  const semis = Number(pitchRange.value);
  if (tempoPct===100 && semis===0){
    state.currentBuffer = state.originalBuffer;
    exportMixBtn.disabled = true;
    drawWaveform(state.currentBuffer,0);
    return;
  }
  stopPlayback();
  renderBtn.disabled = true;
  renderProgress.hidden = false;
  renderProgressBar.style.width = '0%';
  try{
    const rendered = await renderTempoPitch(state.originalBuffer, tempoPct, semis, (p)=>{
      renderProgressBar.style.width = `${Math.round(p*100)}%`;
    });
    state.currentBuffer = rendered;
    exportMixBtn.disabled = false;
    drawWaveform(rendered, 0);
    updateTimeLabel(0, rendered.duration);
  }catch(err){
    console.error(err);
    alert('No se pudo renderizar. Probá con un archivo más corto.');
  }finally{
    renderBtn.disabled = false;
    setTimeout(()=> renderProgress.hidden = true, 400);
  }
});

exportMixBtn.addEventListener('click', ()=>{
  if (!state.currentBuffer) return;
  const blob = audioBufferToWav(state.currentBuffer);
  downloadBlob(blob, `${state.fileName || 'pista'}_tempo${tempoRange.value}_pitch${pitchRange.value}.wav`);
});

/* ============================================================
   Separación de stems (DSP clásico, offline con filtros nativos)
   ============================================================ */
const separateBtn = document.getElementById('separateBtn');
const stemProgress = document.getElementById('stemProgress');
const stemProgressBar = document.getElementById('stemProgressBar');
const stemGrid = document.getElementById('stemGrid');

separateBtn.addEventListener('click', async ()=>{
  if (!state.currentBuffer) return;
  separateBtn.disabled = true;
  stemProgress.hidden = false;
  stemProgressBar.style.width = '10%';
  try{
    const buf = state.currentBuffer;
    const stems = await separateStems(buf, (p)=>{ stemProgressBar.style.width = `${Math.round(p*100)}%`; });
    state.stems = stems;
    renderStemGrid(stems);
  }catch(err){
    console.error(err);
    alert('No se pudo separar el audio.');
  }finally{
    separateBtn.disabled = false;
    setTimeout(()=> stemProgress.hidden = true, 400);
  }
});

async function separateStems(buffer, onProgress){
  const sr = buffer.sampleRate;
  const len = buffer.length;
  const nCh = buffer.numberOfChannels;

  const L = buffer.getChannelData(0);
  const R = nCh>1 ? buffer.getChannelData(1) : L;

  // mid/side clásico: side cancela lo panneado al centro (típicamente voz) -> aproximación de instrumental
  const mid = new Float32Array(len);
  const side = new Float32Array(len);
  for (let i=0;i<len;i++){
    mid[i] = (L[i]+R[i])/2;
    side[i] = (L[i]-R[i])/2;
  }
  onProgress && onProgress(0.15);
  await yieldFrame();

  const instrumental = await stereoFromMono(side, side, sr); // side duplicado a estéreo
  onProgress && onProgress(0.3);

  const vocalsMono = await bandFilterMono(mid, sr, 'bandpass', 220, 4000);
  const vocals = await stereoFromMono(vocalsMono, vocalsMono, sr);
  onProgress && onProgress(0.5);

  const bassMono = await bandFilterMono(mid, sr, 'lowpass', 160);
  const bass = await stereoFromMono(bassMono, bassMono, sr);
  onProgress && onProgress(0.68);

  // "batería/otros": lo que queda del mid al sacar aprox. voz y graves, con énfasis en transitorios
  const remainderMono = new Float32Array(len);
  const vChan = vocals.getChannelData(0);
  const bChan = bass.getChannelData(0);
  for (let i=0;i<len;i++){
    remainderMono[i] = mid[i] - vChan[i]*0.6 - bChan[i]*0.5;
  }
  const drumsMono = await bandFilterMono(remainderMono, sr, 'highpass', 120);
  const drums = await stereoFromMono(drumsMono, drumsMono, sr);
  onProgress && onProgress(0.95);

  onProgress && onProgress(1);
  return { vocals, instrumental, bass, drums };
}

function stereoFromMono(dataL, dataR, sr){
  const ctx = getCtx();
  const len = dataL.length;
  const buf = ctx.createBuffer(2, len, sr);
  buf.getChannelData(0).set(dataL);
  buf.getChannelData(1).set(dataR);
  return Promise.resolve(buf);
}

async function bandFilterMono(monoData, sr, type, freq, freq2){
  const len = monoData.length;
  const offlineCtx = new OfflineAudioContext(1, len, sr);
  const srcBuf = offlineCtx.createBuffer(1, len, sr);
  srcBuf.getChannelData(0).set(monoData);
  const src = offlineCtx.createBufferSource();
  src.buffer = srcBuf;

  if (type==='bandpass'){
    const hp = offlineCtx.createBiquadFilter();
    hp.type='highpass'; hp.frequency.value=freq; hp.Q.value=0.7;
    const lp = offlineCtx.createBiquadFilter();
    lp.type='lowpass'; lp.frequency.value=freq2; lp.Q.value=0.7;
    src.connect(hp); hp.connect(lp); lp.connect(offlineCtx.destination);
  } else {
    const f = offlineCtx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value=0.7;
    src.connect(f); f.connect(offlineCtx.destination);
  }
  src.start(0);
  const rendered = await offlineCtx.startRendering();
  return rendered.getChannelData(0);
}

const STEM_META = {
  vocals:       { label:'Voz (aprox.)',        color:'#FF6A2B' },
  instrumental: { label:'Instrumental',         color:'#4FE0C4' },
  bass:         { label:'Bajo',                 color:'#8A8178' },
  drums:        { label:'Batería / otros',      color:'#F2ECE3' }
};

function renderStemGrid(stems){
  stemGrid.innerHTML = '';
  stemGrid.hidden = false;
  Object.keys(stems).forEach(key=>{
    const meta = STEM_META[key];
    const card = document.createElement('div');
    card.className = 'stem-card';
    card.innerHTML = `
      <h3><span class="stem-dot" style="background:${meta.color}"></span>${meta.label}</h3>
      <div class="row">
        <button class="btn play-stem" data-key="${key}">▶ Escuchar</button>
      </div>
      <div class="row">
        <button class="btn download-stem" data-key="${key}">Descargar WAV</button>
      </div>
    `;
    stemGrid.appendChild(card);
  });

  stemGrid.querySelectorAll('.play-stem').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const key = btn.dataset.key;
      playBufferOnce(state.stems[key]);
    });
  });
  stemGrid.querySelectorAll('.download-stem').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const key = btn.dataset.key;
      const blob = audioBufferToWav(state.stems[key]);
      downloadBlob(blob, `${state.fileName || 'pista'}_${key}.wav`);
    });
  });
}

let previewSource = null;
function playBufferOnce(buffer){
  if (!buffer) return;
  const ctx = getCtx();
  if (ctx.state==='suspended') ctx.resume();
  if (previewSource){ try{ previewSource.stop(); }catch(e){} }
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start(0);
  previewSource = src;
}

/* ============================================================
   Encoder WAV (16-bit PCM)
   ============================================================ */
function audioBufferToWav(buffer){
  const nCh = buffer.numberOfChannels;
  const len = buffer.length;
  const sr = buffer.sampleRate;
  const bytesPerSample = 2;
  const blockAlign = nCh*bytesPerSample;
  const dataSize = len*blockAlign;
  const bufferArr = new ArrayBuffer(44+dataSize);
  const view = new DataView(bufferArr);

  function writeStr(offset, str){ for (let i=0;i<str.length;i++) view.setUint8(offset+i, str.charCodeAt(i)); }

  writeStr(0,'RIFF');
  view.setUint32(4, 36+dataSize, true);
  writeStr(8,'WAVE');
  writeStr(12,'fmt ');
  view.setUint32(16,16,true);
  view.setUint16(20,1,true);
  view.setUint16(22,nCh,true);
  view.setUint32(24,sr,true);
  view.setUint32(28, sr*blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeStr(36,'data');
  view.setUint32(40, dataSize, true);

  const channels = [];
  for (let c=0;c<nCh;c++) channels.push(buffer.getChannelData(c));
  let offset=44;
  for (let i=0;i<len;i++){
    for (let c=0;c<nCh;c++){
      let s = Math.max(-1, Math.min(1, channels[c][i]));
      s = s<0 ? s*0x8000 : s*0x7FFF;
      view.setInt16(offset, s, true);
      offset+=2;
    }
  }
  return new Blob([bufferArr], {type:'audio/wav'});
}

function downloadBlob(blob, filename){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(()=>{ document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
}

/* ============================================================
   Service worker (PWA offline)
   ============================================================ */
if ('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('sw.js').catch(()=>{});
  });
}
