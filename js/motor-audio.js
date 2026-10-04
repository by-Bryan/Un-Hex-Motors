/*
 * Un-Hex Motors — motor de analisis de audio en el navegador.
 * Traduccion fiel del pipeline de Python (src/audio_utils.py y
 * src/pipeline_audio.py). Cada paso reproduce la operacion equivalente
 * de numpy/scipy; los resultados se verificaron numericamente contra
 * el pipeline de Python.
 *
 * Fuente de verdad: el repo detector-fallas-mecanicas (src/audio_utils.py y
 * src/pipeline_audio.py). Si cambia alguna constante o paso alli, se debe
 * replicar en este archivo.
 */
(function (global) {
  "use strict";

  var CFG = {
    SAMPLE_RATE: 44100,
    NPERSEG: 2048,
    NOVERLAP: 1536,
    N_MELS: 40,
    N_MFCC: 13,
    MEL_FMIN_HZ: 0,
    MEL_FMAX_HZ: 7600,
    NIVEL_PISO_LOG: 1e-10,
    DURACION_SEGMENTO_SEGUNDOS: 30,
    MAX_DURACION_TOTAL_SEGUNDOS: 300,
    MAX_TAMANO_BYTES: 64 * 1024 * 1024,
    DURACION_MINIMA_SEGUNDOS: 0.1
  };

  function ErrorAudio(msg) { var e = new Error(msg); e.name = "ErrorAudio"; return e; }

  // ------------------------------------------------------------------
  // Lectura y validacion de WAV (equivale a validar_archivo_audio +
  // cargar_audio, sin la parte de rutas que solo aplica en disco)
  // ------------------------------------------------------------------
  function leerWav(buffer, nombre) {
    var tam = buffer.byteLength;
    if (nombre !== undefined && !/\.wav$/i.test(nombre)) {
      var ext = (nombre.match(/\.[^.]*$/) || [""])[0];
      throw ErrorAudio("Extension no permitida: " + (ext || "(sin extension)"));
    }
    if (tam === 0) throw ErrorAudio("Archivo vacio");
    if (tam > CFG.MAX_TAMANO_BYTES) {
      throw ErrorAudio("Archivo muy grande: " + (tam / 1024 / 1024).toFixed(1) + " MB");
    }
    var dv = new DataView(buffer);
    function txt(o) { return String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3)); }
    if (tam < 12 || txt(0) !== "RIFF" || txt(8) !== "WAVE") {
      throw ErrorAudio("WAV invalido: el archivo no tiene encabezado RIFF/WAVE");
    }
    var pos = 12, fmt = null, dataOff = -1, dataLen = 0;
    while (pos + 8 <= tam) {
      var id = txt(pos), len = dv.getUint32(pos + 4, true), cuerpo = pos + 8;
      if (id === "fmt ") {
        if (len < 16 || cuerpo + 16 > tam) throw ErrorAudio("WAV invalido: bloque fmt incompleto");
        var tag = dv.getUint16(cuerpo, true);
        if (tag === 0xFFFE && len >= 40 && cuerpo + 26 <= tam) tag = dv.getUint16(cuerpo + 24, true);
        fmt = {
          tag: tag,
          canales: dv.getUint16(cuerpo + 2, true),
          sr: dv.getUint32(cuerpo + 4, true),
          bloque: dv.getUint16(cuerpo + 12, true),
          bits: dv.getUint16(cuerpo + 14, true)
        };
      } else if (id === "data") {
        if (!fmt) throw ErrorAudio("WAV invalido: bloque de datos antes del formato");
        dataOff = cuerpo; dataLen = len;
        break;
      }
      pos = cuerpo + len + (len % 2);
    }
    if (!fmt) throw ErrorAudio("WAV invalido: falta el bloque de formato");
    if (dataOff < 0) throw ErrorAudio("WAV invalido: falta el bloque de datos");
    if (fmt.tag !== 1) throw ErrorAudio("WAV invalido: solo se acepta audio PCM (formato " + fmt.tag + ")");
    var sw = Math.ceil(fmt.bits / 8);
    if ([1, 2, 3, 4].indexOf(sw) < 0) throw ErrorAudio("Ancho de muestra no soportado: " + sw + " bytes");
    if (fmt.sr <= 0) throw ErrorAudio("Frecuencia de muestreo invalida");
    if (fmt.canales < 1) throw ErrorAudio("WAV invalido: sin canales");
    var bloque = sw * fmt.canales;
    var framesDecl = Math.floor(dataLen / bloque);
    var dur = framesDecl / fmt.sr;
    if (dur > CFG.MAX_DURACION_TOTAL_SEGUNDOS) {
      throw ErrorAudio("Audio muy largo: " + dur.toFixed(1) + "s (maximo " + CFG.MAX_DURACION_TOTAL_SEGUNDOS + "s)");
    }
    if (dur < CFG.DURACION_MINIMA_SEGUNDOS) throw ErrorAudio("Audio muy corto: " + dur.toFixed(3) + "s");

    var disponibles = Math.min(dataLen, tam - dataOff);
    var frames = Math.floor(disponibles / bloque);
    var ch = fmt.canales, mono = new Float64Array(frames), o = dataOff;
    for (var f = 0; f < frames; f++) {
      var suma = 0;
      for (var c = 0; c < ch; c++) {
        var v;
        if (sw === 1) v = (dv.getUint8(o) - 128) / 128;
        else if (sw === 2) v = dv.getInt16(o, true) / 32768;
        else if (sw === 3) {
          var b = dv.getUint8(o) | (dv.getUint8(o + 1) << 8) | (dv.getUint8(o + 2) << 16);
          if (b & 0x800000) b -= 0x1000000;
          v = b / 8388608;
        } else v = dv.getInt32(o, true) / 2147483648;
        suma += v; o += sw;
      }
      mono[f] = ch > 1 ? suma / ch : suma;
    }
    return { sr: fmt.sr, canales: ch, bits: sw * 8, duracion: frames / fmt.sr, senal: mono };
  }

  // ------------------------------------------------------------------
  // Remuestreo polifasico: reproduce scipy.signal.resample_poly
  // (ventana Kaiser beta=5, filtro de 2*10*max(up,down)+1 coeficientes)
  // ------------------------------------------------------------------
  function mcd(a, b) { while (b) { var t = a % b; a = b; b = t; } return a; }

  function besselI0(x) {
    var suma = 1, termino = 1, k = 1, q = (x / 2) * (x / 2);
    while (true) {
      termino *= q / (k * k);
      suma += termino;
      if (termino < suma * 1e-17) break;
      k++;
    }
    return suma;
  }

  function filtroFir(numtaps, fc) {
    var h = new Float64Array(numtaps), alpha = (numtaps - 1) / 2, beta = 5.0, i0b = besselI0(beta), s = 0;
    for (var n = 0; n < numtaps; n++) {
      var m = n - alpha, x = fc * m;
      var sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      var r = (n - alpha) / alpha;
      var w = besselI0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / i0b;
      h[n] = fc * sinc * w;
      s += h[n];
    }
    for (var j = 0; j < numtaps; j++) h[j] /= s;
    return h;
  }

  function remuestrear(x, srOrigen, srDestino) {
    if (srDestino === undefined) srDestino = CFG.SAMPLE_RATE;
    if (srOrigen === srDestino) return x;
    var g = mcd(srOrigen, srDestino), up = srDestino / g, down = srOrigen / g;
    var nIn = x.length, nOut = Math.ceil(nIn * up / down);
    var maxRate = Math.max(up, down), halfLen = 10 * maxRate;
    var base = filtroFir(2 * halfLen + 1, 1 / maxRate);
    var nPrePad = down - (halfLen % down);
    var nPreRemove = Math.floor((halfLen + nPrePad) / down);
    var h = new Float64Array(nPrePad + base.length);
    for (var i = 0; i < base.length; i++) h[nPrePad + i] = base[i] * up;
    var y = new Float64Array(nOut), lh = h.length;
    for (var k = 0; k < nOut; k++) {
      var t = (k + nPreRemove) * down, j0 = t % up, acc = 0;
      for (var j = j0; j < lh; j += up) {
        var xi = (t - j) / up;
        if (xi < 0) break;
        if (xi < nIn) acc += h[j] * x[xi];
      }
      y[k] = acc;
    }
    return y;
  }

  function normalizarPico(x) {
    var mx = 0;
    for (var i = 0; i < x.length; i++) { var a = Math.abs(x[i]); if (a > mx) mx = a; }
    if (mx > 0) { var y = new Float64Array(x.length); for (var j = 0; j < x.length; j++) y[j] = x[j] / mx; return y; }
    return x;
  }

  // ------------------------------------------------------------------
  // Segmentacion: equivale a numpy.array_split en n partes iguales
  // ------------------------------------------------------------------
  function segmentar(x, sr, maxSegundos) {
    if (sr === undefined) sr = CFG.SAMPLE_RATE;
    if (maxSegundos === undefined) maxSegundos = CFG.DURACION_SEGMENTO_SEGUNDOS;
    var maxM = Math.floor(maxSegundos * sr);
    var n = Math.max(1, Math.ceil(x.length / maxM));
    var base = Math.floor(x.length / n), extra = x.length % n, segs = [], ini = 0;
    for (var i = 0; i < n; i++) {
      var len = base + (i < extra ? 1 : 0);
      segs.push({ inicio: ini, fin: ini + len });
      ini += len;
    }
    return segs;
  }

  // ------------------------------------------------------------------
  // FFT radix-2 (tamano fijo NPERSEG)
  // ------------------------------------------------------------------
  function crearFFT(N) {
    var bits = Math.round(Math.log2(N)), rev = new Uint32Array(N), cos = new Float64Array(N / 2), sin = new Float64Array(N / 2);
    for (var i = 0; i < N; i++) {
      var r = 0, v = i;
      for (var b = 0; b < bits; b++) { r = (r << 1) | (v & 1); v >>= 1; }
      rev[i] = r;
    }
    for (var k = 0; k < N / 2; k++) { cos[k] = Math.cos(2 * Math.PI * k / N); sin[k] = -Math.sin(2 * Math.PI * k / N); }
    return function (re, im) {
      for (var i = 0; i < N; i++) {
        var j = rev[i];
        if (j > i) { var t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
      }
      for (var tam = 2; tam <= N; tam <<= 1) {
        var mitad = tam >> 1, paso = N / tam;
        for (var ini = 0; ini < N; ini += tam) {
          for (var m = 0; m < mitad; m++) {
            var wr = cos[m * paso], wi = sin[m * paso], a = ini + m, c = a + mitad;
            var tr = re[c] * wr - im[c] * wi, ti = re[c] * wi + im[c] * wr;
            re[c] = re[a] - tr; im[c] = im[a] - ti;
            re[a] += tr; im[a] += ti;
          }
        }
      }
    };
  }

  function hzAMel(hz) { return 2595 * Math.log10(1 + hz / 700); }
  function melAHz(mel) { return 700 * (Math.pow(10, mel / 2595) - 1); }

  function bancoMel(nFiltros, nFft, sr, fmin, fmax) {
    if (fmin === undefined) fmin = CFG.MEL_FMIN_HZ;
    if (fmax === undefined) fmax = CFG.MEL_FMAX_HZ;
    fmax = Math.min(fmax, sr / 2);
    var nb = nFft / 2 + 1, mmin = hzAMel(fmin), mmax = hzAMel(fmax), p = [], filtros = [];
    for (var i = 0; i < nFiltros + 2; i++) p.push(melAHz(mmin + (mmax - mmin) * i / (nFiltros + 1)));
    for (var f = 0; f < nFiltros; f++) {
      var izq = p[f], cen = p[f + 1], der = p[f + 2], pesos = [], bins = [];
      for (var b = 0; b < nb; b++) {
        var hz = (sr / 2) * b / (nb - 1);
        var w = Math.max(0, Math.min((hz - izq) / (cen - izq), (der - hz) / (der - cen)));
        if (w > 0) { bins.push(b); pesos.push(w); }
      }
      filtros.push({ bins: bins, pesos: pesos });
    }
    return filtros;
  }

  var _cache = null;
  function recursos() {
    if (_cache) return _cache;
    var N = CFG.NPERSEG, hann = new Float64Array(N), suma = 0;
    for (var n = 0; n < N; n++) { hann[n] = 0.5 - 0.5 * Math.cos(2 * Math.PI * n / N); suma += hann[n]; }
    var fft = crearFFT(N), wr = new Float64Array(N), wi = new Float64Array(N);
    for (var i = 0; i < N; i++) wr[i] = hann[i];
    fft(wr, wi); // espectro de la ventana: permite restar la media (detrend) sin otra FFT
    var dctCos = [];
    for (var k = 0; k < CFG.N_MFCC; k++) {
      var fila = new Float64Array(CFG.N_MELS), esc = k === 0 ? Math.sqrt(1 / CFG.N_MELS) : Math.sqrt(2 / CFG.N_MELS);
      for (var m = 0; m < CFG.N_MELS; m++) fila[m] = esc * Math.cos(Math.PI * k * (2 * m + 1) / (2 * CFG.N_MELS));
      dctCos.push(fila);
    }
    _cache = { hann: hann, escala: 1 / (suma * suma), fft: fft, winRe: wr, winIm: wi,
               mel: bancoMel(CFG.N_MELS, N, CFG.SAMPLE_RATE), dct: dctCos };
    return _cache;
  }

  // ------------------------------------------------------------------
  // Espectrograma (dB, como scipy.signal.spectrogram scaling='spectrum')
  // y MFCC (como calcular_mfcc) sobre un segmento
  // ------------------------------------------------------------------
  function analizarSegmento(x, inicio, fin) {
    var N = CFG.NPERSEG, hop = N - CFG.NOVERLAP, len = fin - inicio, nb = N / 2 + 1;
    if (len < N) throw ErrorAudio("Senal demasiado corta para MFCC: " + len + " muestras (minimo " + N + ")");
    var R = recursos(), nFrames = 1 + Math.floor((len - N) / hop);
    var espec = new Float32Array(nFrames * nb), mfcc = new Float64Array(CFG.N_MFCC * nFrames);
    var re = new Float64Array(N), im = new Float64Array(N), melLog = new Float64Array(CFG.N_MELS), potencia = new Float64Array(nb);
    for (var fr = 0; fr < nFrames; fr++) {
      var s = inicio + fr * hop, media = 0;
      for (var n = 0; n < N; n++) { re[n] = x[s + n] * R.hann[n]; im[n] = 0; media += x[s + n]; }
      media /= N;
      R.fft(re, im);
      for (var b = 0; b < nb; b++) {
        potencia[b] = re[b] * re[b] + im[b] * im[b];
        var dr = re[b] - media * R.winRe[b], di = im[b] - media * R.winIm[b];
        var p = (dr * dr + di * di) * R.escala;
        if (b > 0 && b < nb - 1) p *= 2;
        espec[fr * nb + b] = 10 * Math.log10(Math.max(p, CFG.NIVEL_PISO_LOG));
      }
      for (var m = 0; m < CFG.N_MELS; m++) {
        var f = R.mel[m], acc = 0;
        for (var q = 0; q < f.bins.length; q++) acc += f.pesos[q] * potencia[f.bins[q]];
        melLog[m] = Math.log(Math.max(acc, CFG.NIVEL_PISO_LOG));
      }
      for (var k = 0; k < CFG.N_MFCC; k++) {
        var fila = R.dct[k], c = 0;
        for (var m2 = 0; m2 < CFG.N_MELS; m2++) c += fila[m2] * melLog[m2];
        mfcc[k * nFrames + fr] = c;
      }
    }
    return { frames: nFrames, bins: nb, espectrograma: espec, mfcc: mfcc };
  }

  // Carga completa: lee, mezcla a mono, remuestrea a 44.1 kHz, normaliza
  // y calcula los segmentos. Cada segmento se analiza bajo demanda.
  function prepararArchivo(buffer, nombre) {
    var w = leerWav(buffer, nombre);
    var senal = normalizarPico(remuestrear(w.senal, w.sr, CFG.SAMPLE_RATE));
    return { original: { sr: w.sr, canales: w.canales, bits: w.bits, duracion: w.duracion },
             sr: CFG.SAMPLE_RATE, senal: senal, segmentos: segmentar(senal, CFG.SAMPLE_RATE) };
  }

  // Generador sintetico (misma receta que audio_utils.py, ruido con semilla)
  function generarSintetico(tipo, duracion, semilla) {
    var sr = CFG.SAMPLE_RATE, n = Math.floor(sr * duracion), x = new Float64Array(n), st = semilla >>> 0 || 1;
    function azar() { st |= 0; st = (st + 0x6D2B79F5) | 0; var t = Math.imul(st ^ (st >>> 15), 1 | st); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
    function normal() { var u = 1 - azar(), v = azar(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
    for (var i = 0; i < n; i++) {
      var t = i / sr, v;
      if (tipo === "falla") {
        v = 0.5 * Math.sin(2 * Math.PI * 80 * t) + 0.2 * Math.sin(2 * Math.PI * 160 * t)
          + 0.30 * Math.abs(Math.sin(2 * Math.PI * 6 * t)) * Math.sin(2 * Math.PI * 350 * t)
          + 0.15 * Math.max(0, Math.min(1, Math.sin(2 * Math.PI * 1.5 * t))) * Math.sin(2 * Math.PI * 2200 * t)
          + 0.08 * normal();
      } else {
        v = 0.6 * Math.sin(2 * Math.PI * 80 * t) + 0.25 * Math.sin(2 * Math.PI * 160 * t)
          + 0.10 * Math.sin(2 * Math.PI * 320 * t) + 0.04 * Math.sin(2 * Math.PI * 640 * t) + 0.02 * normal();
      }
      x[i] = v;
    }
    var y = normalizarPico(x);
    return { original: { sr: sr, canales: 1, bits: 64, duracion: n / sr }, sr: sr, senal: y, segmentos: segmentar(y, sr) };
  }

  // Ayuda de visualizacion (no forma parte del pipeline de Python):
  // picos de la potencia media del segmento entre 20 Hz y fmax, con
  // interpolacion parabolica para ubicar la frecuencia entre bins.
  function picosDominantes(R, sr, cuantos, fmax) {
    if (cuantos === undefined) cuantos = 5;
    if (fmax === undefined) fmax = 8000;
    var N = CFG.NPERSEG, res = sr / N, nb = R.bins, maxB = Math.min(nb - 2, Math.floor(fmax / res));
    var P = new Float64Array(maxB + 2);
    for (var b = 0; b <= maxB + 1; b++) {
      var s = 0;
      for (var f = 0; f < R.frames; f++) s += Math.pow(10, R.espectrograma[f * nb + b] / 10);
      P[b] = s / R.frames;
    }
    var cand = [], bmin = Math.max(1, Math.ceil(20 / res));
    for (var k = bmin; k <= maxB; k++) if (P[k] > P[k - 1] && P[k] >= P[k + 1]) cand.push(k);
    cand.sort(function (a, c) { return P[c] - P[a]; });
    var elegidos = [];
    for (var i = 0; i < cand.length && elegidos.length < cuantos; i++) {
      var ok = true;
      for (var j = 0; j < elegidos.length; j++) if (Math.abs(elegidos[j] - cand[i]) <= 2) ok = false;
      if (elegidos.length && P[cand[i]] < P[elegidos[0]] * 1e-3) ok = false; // mas de 30 dB abajo: ruido
      if (ok) elegidos.push(cand[i]);
    }
    if (!elegidos.length) return [];
    var ref = P[elegidos[0]];
    return elegidos.map(function (k) {
      var a = Math.log(P[k - 1] + 1e-300), c0 = Math.log(P[k] + 1e-300), d = Math.log(P[k + 1] + 1e-300);
      var den = a - 2 * c0 + d, delta = den !== 0 ? 0.5 * (a - d) / den : 0;
      if (!isFinite(delta) || Math.abs(delta) > 0.5) delta = 0;
      return { hz: (k + delta) * res, db: 10 * Math.log10(P[k] / ref) };
    });
  }

  var API = { CFG: CFG, leerWav: leerWav, remuestrear: remuestrear, normalizarPico: normalizarPico,
              segmentar: segmentar, bancoMel: bancoMel, analizarSegmento: analizarSegmento,
              prepararArchivo: prepararArchivo, generarSintetico: generarSintetico,
              picosDominantes: picosDominantes };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  global.UnHexDSP = API;
})(typeof globalThis !== "undefined" ? globalThis : this);

