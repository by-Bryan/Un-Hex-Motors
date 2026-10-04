(function () {
  "use strict";
  var DSP = window.UnHexDSP;
  if (!DSP) return;
  var $ = function (id) { return document.getElementById(id); };
  var el = {
    zona: $("ax-zona"), archivo: $("ax-archivo"), estado: $("ax-estado"), segs: $("ax-segmentos"),
    espec: $("ax-espec"), mfcc: $("ax-mfcc"), picos: $("ax-picos"), tip: $("ax-tooltip"),
    mNombre: $("ax-m-nombre"), mFormato: $("ax-m-formato"), mDur: $("ax-m-duracion"), mSegs: $("ax-m-segmentos"),
    ejemplos: document.querySelectorAll("#analizador [data-ejemplo]")
  };
  if (!el.espec || !el.mfcc) return;

  var HZ_MAX_VISTA = 8000, RANGO_DB = 80;
  var estado = { prep: null, nombre: "", seg: 0, R: null, turno: 0 };

  // ---------- color ----------
  function hexRgb(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
  function lut(paradas) {
    var p = paradas.map(hexRgb), t = new Uint8ClampedArray(256 * 3);
    for (var i = 0; i < 256; i++) {
      var x = i / 255 * (p.length - 1), a = Math.min(p.length - 2, Math.floor(x)), f = x - a;
      for (var c = 0; c < 3; c++) t[i * 3 + c] = Math.round(p[a][c] + (p[a + 1][c] - p[a][c]) * f);
    }
    return t;
  }
  var LUT_SEQ = lut(["#0f1e27", "#0c3440", "#0a525a", "#077a7d", "#00a89e", "#00d4c8", "#8ff0e8"]);
  var LUT_DIV = lut(["#86b6ef", "#3987e5", "#2a5fa8", "#1e3f73", "#383835", "#6b2a45", "#a33a66", "#d55181", "#f09bbd"]);
  function tinta(nombre, def) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(nombre);
    return (v && v.trim()) || def;
  }

  // ---------- formato ----------
  function sinCeros(txt) { return txt.indexOf(".") < 0 ? txt : txt.replace(/0+$/, "").replace(/\.$/, ""); }
  function fmtHz(hz) { return hz >= 1000 ? sinCeros((hz / 1000).toFixed(2)) + " kHz" : Math.round(hz) + " Hz"; }
  function fmtT(s) {
    if (s < 60) return (s < 10 ? s.toFixed(2) : s.toFixed(1)) + " s";
    var m = Math.floor(s / 60), r = s - m * 60, rt = r.toFixed(1);
    if (rt === "60.0") { m += 1; rt = "0.0"; }
    return m + ":" + (parseFloat(rt) < 10 ? "0" : "") + rt;
  }
  function fmtDur(s) { return s < 60 ? s.toFixed(1) + " s" : Math.floor(s / 60) + " min " + Math.round(s % 60) + " s"; }
  function signo(v, d) { return (v < 0 ? "−" : "") + Math.abs(v).toFixed(d); }

  function mensajeAmigable(msg) {
    var m;
    if (/^Extension no permitida/.test(msg)) return "Solo se aceptan archivos .wav.";
    if (/^Archivo vacio/.test(msg)) return "El archivo está vacío.";
    if ((m = msg.match(/^Archivo muy grande: ([\d.]+) MB/))) return "El archivo pesa " + m[1] + " MB; el máximo es 64 MB.";
    if ((m = msg.match(/^Audio muy largo: ([\d.]+)s/))) return "El audio dura " + fmtDur(parseFloat(m[1])) + "; el máximo es 5 min.";
    if (/^Audio muy corto/.test(msg)) return "El audio dura menos de 0.1 s; graba al menos un segundo.";
    if (/^Ancho de muestra no soportado/.test(msg)) return "Resolución no soportada. Usa un WAV de 8, 16, 24 o 32 bits.";
    if (/solo se acepta audio PCM/.test(msg)) return "Este WAV usa un formato comprimido o de punto flotante. Expórtalo como WAV PCM (16 bits) e inténtalo de nuevo.";
    if (/^WAV invalido/.test(msg)) return "El archivo no es un WAV válido. Expórtalo de nuevo como WAV PCM e inténtalo otra vez.";
    if (/^Frecuencia de muestreo invalida/.test(msg)) return "El archivo tiene una frecuencia de muestreo inválida.";
    return "No se pudo analizar el archivo.";
  }

  function ponerEstado(texto, error) {
    el.estado.textContent = texto;
    el.estado.classList.toggle("ax-error", !!error);
    el.estado.setAttribute("role", error ? "alert" : "status");
  }

  // ---------- lienzos ----------
  var M = { izq: 50, der: 8, arr: 6, aba: 26 };
  function prepararLienzo(cv) {
    var dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = parseInt(cv.getAttribute("data-alto"), 10);
    cv.style.height = h + "px";
    cv.width = Math.max(1, Math.round(w * dpr)); cv.height = Math.round(h * dpr);
    var ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: w, h: h, pw: Math.max(10, w - M.izq - M.der), ph: h - M.arr - M.aba, dpr: dpr };
  }

  function pasoTiempo(dur, pw) {
    var maxTicks = Math.max(2, Math.floor(pw / 70)), pasos = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30];
    for (var i = 0; i < pasos.length; i++) if (dur / pasos[i] <= maxTicks) return pasos[i];
    return 30;
  }

  function ejes(L, t0, t1, etiquetasY) {
    var ctx = L.ctx, sec = tinta("--color-text-secondary", "#94a3b8"), borde = tinta("--color-border", "#1e293b");
    ctx.font = "11px Inter, system-ui, sans-serif"; ctx.fillStyle = sec; ctx.strokeStyle = borde; ctx.lineWidth = 1;
    ctx.textAlign = "right"; ctx.textBaseline = "middle";
    etiquetasY.forEach(function (e) {
      var y = M.arr + (1 - e.pos) * L.ph;
      ctx.fillText(e.txt, M.izq - 8, y);
    });
    var dur = t1 - t0, paso = pasoTiempo(dur, L.pw), primero = Math.ceil(t0 / paso - 1e-9) * paso;
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    for (var t = primero; t <= t1 + 1e-9; t += paso) {
      var x = M.izq + (t - t0) / dur * L.pw;
      ctx.beginPath(); ctx.moveTo(x + 0.5, M.arr + L.ph); ctx.lineTo(x + 0.5, M.arr + L.ph + 4); ctx.stroke();
      var txt = (paso < 1 ? t.toFixed(paso < 0.5 ? 2 : 1) : Math.round(t)) + " s";
      ctx.fillText(txt, Math.min(Math.max(x, M.izq + 12), M.izq + L.pw - 12), M.arr + L.ph + 7);
    }
  }

  function dibujarMapa(L, ancho, alto, pixel) {
    // imagen fuera de pantalla a resolucion de datos, escalada al area de trazado
    var off = document.createElement("canvas");
    off.width = ancho; off.height = alto;
    var octx = off.getContext("2d"), img = octx.createImageData(ancho, alto), d = img.data;
    for (var y = 0; y < alto; y++) for (var x = 0; x < ancho; x++) {
      var rgb = pixel(x, alto - 1 - y), o = (y * ancho + x) * 4;
      d[o] = rgb[0]; d[o + 1] = rgb[1]; d[o + 2] = rgb[2]; d[o + 3] = 255;
    }
    octx.putImageData(img, 0, 0);
    L.ctx.imageSmoothingEnabled = true;
    if ("imageSmoothingQuality" in L.ctx) L.ctx.imageSmoothingQuality = "high";
    L.ctx.drawImage(off, M.izq, M.arr, L.pw, L.ph);
  }

  function binsVista(R) { return Math.min(R.bins - 1, Math.floor(HZ_MAX_VISTA / (estado.prep.sr / DSP.CFG.NPERSEG))) + 1; }

  function dibujarEspectrograma() {
    var R = estado.R, L = prepararLienzo(el.espec), nb = R.bins, filas = binsVista(R);
    var cols = Math.max(1, Math.min(R.frames, Math.round(L.pw * L.dpr))), vmax = -Infinity;
    for (var i = 0; i < R.frames * nb; i++) { var b = i % nb; if (b < filas && R.espectrograma[i] > vmax) vmax = R.espectrograma[i]; }
    var vmin = vmax - RANGO_DB, col = new Float32Array(cols * filas).fill(-Infinity);
    for (var f = 0; f < R.frames; f++) {
      var c = Math.min(cols - 1, Math.floor(f * cols / R.frames));
      for (var k = 0; k < filas; k++) { var v = R.espectrograma[f * nb + k]; if (v > col[c * filas + k]) col[c * filas + k] = v; }
    }
    var tmp = [0, 0, 0];
    dibujarMapa(L, cols, filas, function (x, y) {
      var t = (col[x * filas + y] - vmin) / RANGO_DB, i = Math.max(0, Math.min(255, Math.round(t * 255))) * 3;
      tmp[0] = LUT_SEQ[i]; tmp[1] = LUT_SEQ[i + 1]; tmp[2] = LUT_SEQ[i + 2]; return tmp;
    });
    var s = estado.prep.segmentos[estado.seg], sr = estado.prep.sr, fmaxVista = (filas - 1) * sr / DSP.CFG.NPERSEG;
    ejes(L, s.inicio / sr, s.fin / sr, [0, 2000, 4000, 6000, 8000].filter(function (hz) { return hz <= fmaxVista + 1; })
      .map(function (hz) { return { pos: hz / fmaxVista, txt: hz === 0 ? "0" : hz / 1000 + " kHz" }; }));
    estado.vmax = vmax;
  }

  function dibujarMfcc() {
    var R = estado.R, L = prepararLienzo(el.mfcc), n = DSP.CFG.N_MFCC, F = R.frames;
    var cols = Math.max(1, Math.min(F, Math.round(L.pw * L.dpr))), z = new Float32Array(cols * n);
    for (var k = 0; k < n; k++) {
      var media = 0, v2 = 0;
      for (var f = 0; f < F; f++) media += R.mfcc[k * F + f];
      media /= F;
      for (var f2 = 0; f2 < F; f2++) { var d = R.mfcc[k * F + f2] - media; v2 += d * d; }
      var de = Math.sqrt(v2 / F) || 1, cuenta = new Uint16Array(cols);
      for (var f3 = 0; f3 < F; f3++) {
        var c = Math.min(cols - 1, Math.floor(f3 * cols / F));
        z[c * n + k] += (R.mfcc[k * F + f3] - media) / de; cuenta[c]++;
      }
      for (var c2 = 0; c2 < cols; c2++) if (cuenta[c2]) z[c2 * n + k] /= cuenta[c2];
    }
    var tmp = [0, 0, 0];
    dibujarMapa(L, cols, n, function (x, y) {
      var t = (Math.max(-2.5, Math.min(2.5, z[x * n + y])) / 2.5 + 1) / 2, i = Math.round(t * 255) * 3;
      tmp[0] = LUT_DIV[i]; tmp[1] = LUT_DIV[i + 1]; tmp[2] = LUT_DIV[i + 2]; return tmp;
    });
    var s = estado.prep.segmentos[estado.seg], sr = estado.prep.sr;
    ejes(L, s.inicio / sr, s.fin / sr, [0, 4, 8, 12].map(function (k) { return { pos: (k + 0.5) / n, txt: "c" + k }; }));
  }

  function dibujarPicos() {
    var p = DSP.picosDominantes(estado.R, estado.prep.sr);
    el.picos.innerHTML = "";
    if (!p.length) { el.picos.innerHTML = '<tr><td colspan="2">Sin picos claros en este segmento</td></tr>'; return p; }
    p.forEach(function (x) {
      var tr = document.createElement("tr"), ancho = Math.max(2, 100 + x.db * (100 / 30));
      tr.innerHTML = "<td>" + fmtHz(x.hz) + "</td><td><div class=\"ax-nivel\"><div class=\"ax-nivel-barra\"><span style=\"width:" + ancho.toFixed(1) + "%\"></span></div><span>" + (x.db === 0 ? "0.0" : signo(x.db, 1)) + " dB</span></div></td>";
      el.picos.appendChild(tr);
    });
    return p;
  }

  function dibujarTodo() {
    if (!estado.R) return;
    dibujarEspectrograma();
    dibujarMfcc();
    var p = dibujarPicos(), s = estado.prep.segmentos[estado.seg], sr = estado.prep.sr;
    var rango = fmtT(s.inicio / sr) + " a " + fmtT(s.fin / sr);
    el.espec.setAttribute("aria-label", "Espectrograma de " + rango + (p.length ? ". Frecuencia dominante: " + fmtHz(p[0].hz) : ""));
    el.mfcc.setAttribute("aria-label", "MFCC de " + rango + ", 13 coeficientes");
  }

  // ---------- tooltip ----------
  function mostrarTip(ev, html) {
    el.tip.innerHTML = html; el.tip.hidden = false;
    var r = el.tip.getBoundingClientRect(), x = ev.clientX + 14, y = ev.clientY + 14;
    if (x + r.width > window.innerWidth - 8) x = ev.clientX - r.width - 14;
    if (y + r.height > window.innerHeight - 8) y = ev.clientY - r.height - 14;
    el.tip.style.left = Math.max(8, x) + "px"; el.tip.style.top = Math.max(8, y) + "px";
  }
  function ocultarTip() { el.tip.hidden = true; }
  function posicion(cv, ev) {
    var r = cv.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
    var pw = r.width - M.izq - M.der, ph = parseInt(cv.getAttribute("data-alto"), 10) - M.arr - M.aba;
    var fx = (x - M.izq) / pw, fy = 1 - (y - M.arr) / ph;
    return (fx < 0 || fx >= 1 || fy < 0 || fy >= 1) ? null : { fx: fx, fy: fy };
  }
  function tiempoFrame(f) {
    var s = estado.prep.segmentos[estado.seg], N = DSP.CFG.NPERSEG, hop = N - DSP.CFG.NOVERLAP;
    return (s.inicio + f * hop + N / 2) / estado.prep.sr;
  }
  el.espec.addEventListener("pointermove", function (ev) {
    if (!estado.R) return;
    var p = posicion(el.espec, ev); if (!p) return ocultarTip();
    var R = estado.R, f = Math.min(R.frames - 1, Math.floor(p.fx * R.frames)), filas = binsVista(R), b = Math.min(filas - 1, Math.floor(p.fy * filas));
    var hz = b * estado.prep.sr / DSP.CFG.NPERSEG, db = R.espectrograma[f * R.bins + b];
    mostrarTip(ev, "<b>" + fmtT(tiempoFrame(f)) + "</b> · " + fmtHz(hz) + " · " + signo(db, 1) + " dB");
  });
  el.mfcc.addEventListener("pointermove", function (ev) {
    if (!estado.R) return;
    var p = posicion(el.mfcc, ev); if (!p) return ocultarTip();
    var R = estado.R, n = DSP.CFG.N_MFCC, f = Math.min(R.frames - 1, Math.floor(p.fx * R.frames)), k = Math.min(n - 1, Math.floor(p.fy * n));
    mostrarTip(ev, "<b>" + fmtT(tiempoFrame(f)) + "</b> · coeficiente c" + k + " · valor " + signo(R.mfcc[k * R.frames + f], 2));
  });
  [el.espec, el.mfcc].forEach(function (cv) { cv.addEventListener("pointerleave", ocultarTip); });
  window.addEventListener("scroll", ocultarTip, { passive: true });

  // ---------- flujo ----------
  function elegirSegmento(i) {
    var s = estado.prep.segmentos[i];
    estado.seg = i;
    estado.R = DSP.analizarSegmento(estado.prep.senal, s.inicio, s.fin);
    Array.prototype.forEach.call(el.segs.children, function (b, j) { b.setAttribute("aria-pressed", j === i ? "true" : "false"); });
    dibujarTodo();
  }

  function mostrarResultado(prep, nombre, esEjemplo) {
    estado.prep = prep; estado.nombre = nombre;
    var o = prep.original, n = prep.segmentos.length, sr = prep.sr;
    el.mNombre.textContent = nombre;
    el.mFormato.textContent = esEjemplo ? "Generado en el navegador" : sinCeros((o.sr / 1000).toFixed(2)) + " kHz · " + o.bits + " bits · " + (o.canales === 1 ? "mono" : o.canales === 2 ? "estéreo" : o.canales + " canales");
    el.mDur.textContent = fmtDur(o.duracion);
    el.mSegs.textContent = n === 1 ? "1 (completo)" : n + " de ~" + (prep.segmentos[0].fin / sr).toFixed(1) + " s";
    el.segs.innerHTML = "";
    if (n > 1) {
      prep.segmentos.forEach(function (s, i) {
        var b = document.createElement("button");
        b.type = "button"; b.className = "ax-chip"; b.id = "ax-seg-" + i;
        b.textContent = "Segmento " + (i + 1) + " · " + fmtT(s.inicio / sr) + " a " + fmtT(s.fin / sr);
        b.addEventListener("click", function () { elegirSegmento(i); });
        el.segs.appendChild(b);
      });
    }
    elegirSegmento(0);
    ponerEstado(n > 1 ? "Listo. El audio se dividió en " + n + " segmentos; elige uno para verlo." : "Listo.", false);
  }

  function marcarEjemplo(tipo) {
    Array.prototype.forEach.call(el.ejemplos, function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-ejemplo") === tipo ? "true" : "false"); });
  }

  function cargarEjemplo(tipo) {
    var turno = ++estado.turno;
    marcarEjemplo(tipo);
    try {
      var prep = DSP.generarSintetico(tipo, 5, 42);
      if (turno !== estado.turno) return;
      mostrarResultado(prep, tipo === "falla" ? "Ejemplo: motor con falla (sintético)" : "Ejemplo: motor sano (sintético)", true);
    } catch (e) { ponerEstado("No se pudo generar el ejemplo.", true); }
  }

  function cargarArchivo(file) {
    if (!file) return;
    var turno = ++estado.turno;
    marcarEjemplo(null);
    if (!/\.wav$/i.test(file.name)) return ponerEstado("Solo se aceptan archivos .wav.", true);
    if (file.size > DSP.CFG.MAX_TAMANO_BYTES) return ponerEstado("El archivo pesa " + (file.size / 1048576).toFixed(1) + " MB; el máximo es 64 MB.", true);
    ponerEstado("Analizando " + file.name + "…", false);
    file.arrayBuffer().then(function (buf) {
      return new Promise(function (r) { setTimeout(function () { r(buf); }, 30); });
    }).then(function (buf) {
      if (turno !== estado.turno) return;
      var prep = DSP.prepararArchivo(buf, file.name);
      if (turno !== estado.turno) return;
      mostrarResultado(prep, file.name, false);
    }).catch(function (e) {
      if (turno !== estado.turno) return;
      ponerEstado(mensajeAmigable(e && e.message ? e.message : ""), true);
    });
  }

  el.archivo.addEventListener("change", function () { cargarArchivo(el.archivo.files[0]); el.archivo.value = ""; });
  Array.prototype.forEach.call(el.ejemplos, function (b) { b.addEventListener("click", function () { cargarEjemplo(b.getAttribute("data-ejemplo")); }); });
  ["dragenter", "dragover"].forEach(function (t) { el.zona.addEventListener(t, function (e) { e.preventDefault(); el.zona.classList.add("ax-arrastrando"); }); });
  ["dragleave", "drop"].forEach(function (t) { el.zona.addEventListener(t, function (e) { e.preventDefault(); el.zona.classList.remove("ax-arrastrando"); }); });
  el.zona.addEventListener("drop", function (e) { var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; cargarArchivo(f); });

  var pendiente = false;
  function redibujar() { if (pendiente) return; pendiente = true; requestAnimationFrame(function () { pendiente = false; dibujarTodo(); }); }
  if ("ResizeObserver" in window) new ResizeObserver(redibujar).observe(el.espec.parentNode);
  else window.addEventListener("resize", redibujar);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(redibujar);

  cargarEjemplo("falla");
})();

