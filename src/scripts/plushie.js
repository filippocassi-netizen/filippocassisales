/**
 * Plushie — una foto che si afferra e si stira come un peluche.
 *
 * L'immagine e' una griglia di vertici texturizzata. Ogni nodo porta uno
 * spostamento `u` rispetto alla sua posizione a riposo, e il foglio obbedisce
 * a un'equazione d'onda smorzata con termine di richiamo:
 *
 *     u'' = c²∇²u − ω²·u − γ·u' + ν∇²u'
 *
 *   c²∇²u   la pelle tira i vicini: una trazione trascina l'intorno e, al
 *           rilascio, l'onda viaggia verso l'esterno
 *   −ω²·u   l'attaccatura a quello che sta sotto: riporta tutto a riposo
 *   −γ·u'   quanto in fretta muore l'oscillazione
 *   ν∇²u'   la parte carnosa: le increspature fini muoiono subito, l'onda
 *           lenta e larga prosegue
 *
 * Il rapporto c/ω e' la distanza su cui si propaga una trazione; ω da solo e'
 * la frequenza dell'ondeggiamento.
 *
 * Lavorare sullo spostamento invece che sulle posizioni assolute evita che la
 * maglia abbia lunghezze di riposo attorno a cui piegarsi.
 *
 * La mano e' un pennello rotondo che vive nell'immagine *deformata*: la pelle
 * che gli sta sotto in quel momento si muove con lui, del tutto al centro e
 * sempre meno verso il bordo.
 *
 *     const p = await createPlushie(elemento, { src: '/img/foto.jpg' });
 *     p.destroy();
 *
 * Nessuna dipendenza. WebGL1. Se WebGL manca, resta una fotografia.
 */

const DEFAULT = {
  grid: 56, // nodi per lato: la fisica costa ~0.5ms, conviene una maglia fitta
  smooth: 0.03, // costante di lisciatura del puntatore, secondi
  reach: 0.55, // c  — quanto lontano si propaga una trazione
  wobble: 7.0, // ω  — frequenza dell'ondeggiamento (rad/s)
  damping: 2.4, // γ  — smorzamento
  flesh: 0.012, // ν  — viscosita': uccide le increspature fini
  grabRadius: 0.26, // raggio della mano, in frazione del lato
  maxPull: 0.34, // spostamento massimo, in frazione del lato
  pinBorder: true, // ancora il bordo esterno
  shade: 0.55, // intensita' dell'ombreggiatura sulle pieghe
  substeps: 4, // frequenza della simulazione: 4 -> 240 Hz, a passo fisso

  // --- espressioni (facoltative) -------------------------------------------
  faces: null, // mappa nome -> src; senza, c'e' una faccia sola
  rest: null, // nome della faccia a riposo (default: la prima di `faces`)
  reactions: null, // { hovered, held, pulled, dazed } -> nome o lista di nomi
  pullSoglia: 0.1, // oltre questo spostamento la presa diventa uno strappo
  fade: 140, // durata della dissolvenza fra due facce, ms
  dazedMs: 900, // quanto resta stordito dopo un rilascio forte

  // Punti cliccabili dentro l'immagine, in coordinate UV (0-1):
  //   [{ nome, x, y, r, once, onHit(api) }]
  // Un click dentro la zona chiama onHit e NON avvia la presa, cosi' un
  // dettaglio cliccabile non diventa per sbaglio un punto da cui tirare.
  zones: null,
};

const VERT = `
attribute vec2 a_pos;
attribute vec2 a_uv;
attribute float a_shade;
varying vec2 v_uv;
varying float v_shade;
void main() {
  v_uv = a_uv;
  v_shade = a_shade;
  gl_Position = vec4(a_pos * vec2(2.0, -2.0) + vec2(-1.0, 1.0), 0.0, 1.0);
}`;

const FRAG = `
precision mediump float;
uniform sampler2D u_tex;   // faccia corrente
uniform sampler2D u_tex2;  // faccia in arrivo
uniform float u_mix;       // 0 = solo la corrente, 1 = solo quella in arrivo
varying vec2 v_uv;
varying float v_shade;
void main() {
  vec4 a = texture2D(u_tex, v_uv);
  vec4 b = texture2D(u_tex2, v_uv);
  vec4 c = mix(a, b, u_mix);
  // le zone compresse si scuriscono, quelle stirate si schiariscono appena
  gl_FragColor = vec4(c.rgb * (1.0 + v_shade), c.a);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error('shader: ' + gl.getShaderInfoLog(s));
  }
  return s;
}

function caricaImmagine(src) {
  return new Promise((ok, no) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => ok(img);
    img.onerror = () => no(new Error('immagine non caricata: ' + src));
    img.src = src;
  });
}

export async function createPlushie(host, opzioni = {}) {
  const opt = { ...DEFAULT, ...opzioni };
  const src = opt.src || host.querySelector('img')?.getAttribute('src');
  if (!src) throw new Error('serve una src');

  // `faces` e' una mappa nome -> src. Senza, c'e' una faccia sola e il
  // meccanismo delle espressioni resta inerte.
  const facce = opt.faces && Object.keys(opt.faces).length ? opt.faces : { base: src };
  // la faccia a riposo puo' cambiare a runtime (es. dopo il furto dell'orologio)
  let nomeBase = opt.faces ? (opt.rest || Object.keys(facce)[0]) : 'base';

  const immagini = {};
  await Promise.all(
    Object.entries(facce).map(async ([nome, s]) => { immagini[nome] = await caricaImmagine(s); })
  );
  const img = immagini[nomeBase];

  const canvas = document.createElement('canvas');
  canvas.className = 'plush-canvas';
  canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;cursor:grab';

  const gl =
    canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false, antialias: true }) ||
    canvas.getContext('experimental-webgl');
  if (!gl) throw new Error('WebGL non disponibile');

  // ---- programma ----------------------------------------------------------
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error('link: ' + gl.getProgramInfoLog(prog));
  }
  gl.useProgram(prog);

  const locPos = gl.getAttribLocation(prog, 'a_pos');
  const locUv = gl.getAttribLocation(prog, 'a_uv');
  const locShade = gl.getAttribLocation(prog, 'a_shade');

  // ---- texture, una per espressione ---------------------------------------
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  const texture = {};
  for (const [nome, im] of Object.entries(immagini)) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
    texture[nome] = t;
  }

  const locTex = gl.getUniformLocation(prog, 'u_tex');
  const locTex2 = gl.getUniformLocation(prog, 'u_tex2');
  const locMix = gl.getUniformLocation(prog, 'u_mix');
  gl.uniform1i(locTex, 0);
  gl.uniform1i(locTex2, 1);

  // Dissolvenza fra due espressioni: `da` e' quella mostrata, `a` quella in
  // arrivo, `t` avanza da 0 a 1 e al termine `a` diventa la corrente.
  let facciaDa = nomeBase, facciaA = nomeBase, fadeT = 1, fadeDurata = 1;

  function mostra(nome, ms = 140) {
    if (!texture[nome] || nome === facciaA) return;
    // ms = 0 -> scambio istantaneo, nessuna dissolvenza. Serve quando qualcosa
    // deve sparire di netto (un oggetto rubato non svanisce in dissolvenza:
    // durante l'incrocio lo si vedrebbe ancora, ed e' il difetto piu' evidente).
    if (ms <= 0) {
      facciaDa = nome;
      facciaA = nome;
      fadeT = 1;
      sveglia();
      return;
    }
    // Interrompere una dissolvenza a meta' e ripartire dalla faccia di
    // partenza originale fa un salto all'indietro ben visibile. Si riparte
    // invece da quella che in quel momento e' piu' presente a schermo.
    facciaDa = fadeT >= 0.5 ? facciaA : facciaDa;
    facciaA = nome;
    fadeT = 0;
    fadeDurata = Math.max(16, ms) / 1000;
    sveglia();
  }

  // ---- maglia -------------------------------------------------------------
  const N = Math.max(8, opt.grid | 0); // nodi per lato
  const n = N * N;
  const idx = (r, c) => r * N + c;

  const restX = new Float32Array(n);
  const restY = new Float32Array(n);
  const ux = new Float32Array(n);
  const uy = new Float32Array(n);
  const vx = new Float32Array(n);
  const vy = new Float32Array(n);
  const bordo = new Uint8Array(n);
  const peso = new Float32Array(n); // peso della presa corrente

  const uvArr = new Float32Array(n * 2);
  const posArr = new Float32Array(n * 2);
  const shadeArr = new Float32Array(n);

  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const i = idx(r, c);
      const x = c / (N - 1);
      const y = r / (N - 1);
      restX[i] = x;
      restY[i] = y;
      uvArr[i * 2] = x;
      uvArr[i * 2 + 1] = y;
      if (r === 0 || c === 0 || r === N - 1 || c === N - 1) bordo[i] = 1;
    }
  }

  const indici = [];
  for (let r = 0; r < N - 1; r++) {
    for (let c = 0; c < N - 1; c++) {
      const a = idx(r, c), b = idx(r, c + 1), d = idx(r + 1, c), e = idx(r + 1, c + 1);
      indici.push(a, b, d, b, e, d);
    }
  }
  const indiceArr = n > 65535 ? new Uint32Array(indici) : new Uint16Array(indici);
  const uintOk = gl.getExtension('OES_element_index_uint');
  if (n > 65535 && !uintOk) throw new Error('griglia troppo fitta per questo dispositivo');

  const bufPos = gl.createBuffer();
  const bufUv = gl.createBuffer();
  const bufShade = gl.createBuffer();
  const bufIdx = gl.createBuffer();

  gl.bindBuffer(gl.ARRAY_BUFFER, bufUv);
  gl.bufferData(gl.ARRAY_BUFFER, uvArr, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufIdx);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indiceArr, gl.STATIC_DRAW);

  // ---- fisica -------------------------------------------------------------
  const lapUx = new Float32Array(n);
  const lapUy = new Float32Array(n);
  const lapVx = new Float32Array(n);
  const lapVy = new Float32Array(n);

  function laplaciani() {
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const i = idx(r, c);
        let sx = 0, sy = 0, swx = 0, swy = 0, k = 0;
        if (r > 0)     { const j = i - N; sx += ux[j]; sy += uy[j]; swx += vx[j]; swy += vy[j]; k++; }
        if (r < N - 1) { const j = i + N; sx += ux[j]; sy += uy[j]; swx += vx[j]; swy += vy[j]; k++; }
        if (c > 0)     { const j = i - 1; sx += ux[j]; sy += uy[j]; swx += vx[j]; swy += vy[j]; k++; }
        if (c < N - 1) { const j = i + 1; sx += ux[j]; sy += uy[j]; swx += vx[j]; swy += vy[j]; k++; }
        lapUx[i] = sx - k * ux[i];
        lapUy[i] = sy - k * uy[i];
        lapVx[i] = swx - k * vx[i];
        lapVy[i] = swy - k * vy[i];
      }
    }
  }

  // Valori derivati dai parametri: la scala della griglia entra in c² perche'
  // il laplaciano discreto qui non e' diviso per il passo h.
  let c2 = 0, w2 = 0, nu = 0, maxPull2 = 0;
  function ricalcola() {
    const h2 = (N - 1) * (N - 1);
    c2 = opt.reach * opt.reach * h2 * 0.0012;
    w2 = opt.wobble * opt.wobble;
    nu = opt.flesh * h2 * 0.0012; // stessa scala di c², ma applicato alla velocita'
    maxPull2 = opt.maxPull * opt.maxPull;
  }
  ricalcola();

  function passo(dt) {
    laplaciani();
    for (let i = 0; i < n; i++) {
      if (bordo[i] && opt.pinBorder) { ux[i] = uy[i] = vx[i] = vy[i] = 0; continue; }
      if (peso[i] > 0) continue; // i nodi in mano li comanda il puntatore
      const ax = c2 * lapUx[i] - w2 * ux[i] - opt.damping * vx[i] + nu * lapVx[i];
      const ay = c2 * lapUy[i] - w2 * uy[i] - opt.damping * vy[i] + nu * lapVy[i];
      vx[i] += ax * dt;
      vy[i] += ay * dt;
      ux[i] += vx[i] * dt;
      uy[i] += vy[i] * dt;
      const m2 = ux[i] * ux[i] + uy[i] * uy[i];
      if (m2 > maxPull2) {
        const s = opt.maxPull / Math.sqrt(m2);
        ux[i] *= s; uy[i] *= s;
      }
    }
  }

  // ---- presa --------------------------------------------------------------
  let inMano = false;
  let px = 0, py = 0;

  function posizionePuntatore(ev) {
    const r = canvas.getBoundingClientRect();
    return [(ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height];
  }

  function afferra(x, y) {
    const R = opt.grabRadius, R2 = R * R;
    let presi = 0;
    for (let i = 0; i < n; i++) {
      if (bordo[i] && opt.pinBorder) { peso[i] = 0; continue; }
      // la mano vive nell'immagine deformata
      const dx = restX[i] + ux[i] - x;
      const dy = restY[i] + uy[i] - y;
      const d2 = dx * dx + dy * dy;
      if (d2 > R2) { peso[i] = 0; continue; }
      const t = 1 - Math.sqrt(d2) / R;
      peso[i] = t * t * (3 - 2 * t); // smoothstep: pieno al centro, nullo al bordo
      presi++;
    }
    return presi > 0;
  }

  // Posizione del puntatore filtrata e istante dell'ultimo evento. Il mouse
  // arriva a scatti irregolari: passarlo grezzo alla maglia e dividere per un
  // dt fisso produce strappi e un rimbalzo diverso a ogni frame rate.
  let sx = 0, sy = 0, tPuntatore = 0;

  function trascina(x, y) {
    const ora = performance.now();
    const dt = tPuntatore ? Math.min(0.1, (ora - tPuntatore) / 1000) : 1 / 60;
    tPuntatore = ora;

    // lisciatura esponenziale indipendente dal frame rate
    const a = 1 - Math.exp(-dt / opt.smooth);
    sx += (x - sx) * a;
    sy += (y - sy) * a;

    const dx = sx - px, dy = sy - py;
    const invDt = 1 / Math.max(0.004, dt);

    for (let i = 0; i < n; i++) {
      const w = peso[i];
      if (w <= 0) continue;
      ux[i] += dx * w;
      uy[i] += dy * w;
      const m2 = ux[i] * ux[i] + uy[i] * uy[i];
      if (m2 > maxPull2) {
        const s = opt.maxPull / Math.sqrt(m2);
        ux[i] *= s; uy[i] *= s;
      }
      // la mano imprime velocita' vera: al rilascio il rimbalzo ha senso
      vx[i] = dx * w * invDt;
      vy[i] = dy * w * invDt;
    }
    px = sx; py = sy;
    sveglia();
  }

  function lascia() {
    inMano = false;
    peso.fill(0);
    canvas.style.cursor = 'grab';
  }

  // ---- espressioni: dallo stato dell'interazione alla faccia --------------
  let R = opt.reactions || {};
  const scegli = (v) => (Array.isArray(v) ? v[(Math.random() * v.length) | 0] : v);
  let timerStordito = 0;
  let sopra = false;
  let strappato = false;

  function reagisci(stato) {
    const f = scegli(R[stato]);
    if (f) mostra(f, opt.fade);
    else if (stato === 'rest') mostra(nomeBase, opt.fade);
  }

  function aRiposoFaccia() {
    clearTimeout(timerStordito);
    reagisci(sopra ? 'hovered' : 'rest');
    if (!sopra && !R.hovered) mostra(nomeBase, opt.fade);
  }

  /** Spostamento massimo corrente, per distinguere una carezza da uno strappo. */
  function spostamentoMax() {
    let m = 0;
    for (let i = 0; i < n; i++) {
      const d = ux[i] * ux[i] + uy[i] * uy[i];
      if (d > m) m = d;
    }
    return Math.sqrt(m);
  }

  const onEnter = () => { sopra = true; if (!inMano) reagisci('hovered'); };
  const onLeaveSolo = () => { sopra = false; if (!inMano) aRiposoFaccia(); };

  // ---- zone cliccabili ----------------------------------------------------
  const zone = (opt.zones || []).map((z) => ({ ...z, usata: false }));

  /** La zona sotto il puntatore, cercata nell'immagine *deformata*. */
  function zonaSotto(x, y) {
    for (const z of zone) {
      if (z.usata && z.once) continue;
      // la zona si muove con la maglia: trovo il nodo piu' vicino al suo
      // centro a riposo e uso il suo spostamento corrente
      const c = Math.round(z.x * (N - 1));
      const r = Math.round(z.y * (N - 1));
      const i = idx(Math.max(0, Math.min(N - 1, r)), Math.max(0, Math.min(N - 1, c)));
      const zx = z.x + ux[i], zy = z.y + uy[i];
      if ((x - zx) ** 2 + (y - zy) ** 2 <= z.r * z.r) return z;
    }
    return null;
  }

  /**
   * Dà un colpo alla maglia in un punto: il polso che sussulta.
   * La direzione è radiale normalizzata — dividere per la distanza invece che
   * normalizzarla crea una singolarità al centro e spappola la maglia.
   */
  function colpisci(x, y, forza = 0.5, raggio = 0.14) {
    for (let i = 0; i < n; i++) {
      if (bordo[i] && opt.pinBorder) continue;
      const dx = restX[i] - x, dy = restY[i] - y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > raggio) continue;
      const w = 1 - d / raggio;
      const k = forza * w * w;
      if (d > 1e-4) { vx[i] += (dx / d) * k; vy[i] += (dy / d) * k; }
    }
    sveglia();
  }

  const onDown = (ev) => {
    const [x, y] = posizionePuntatore(ev);

    const z = zonaSotto(x, y);
    if (z) {
      z.usata = true;
      ev.preventDefault();
      colpisci(z.x, z.y, z.forza ?? 0.5);
      z.onHit?.({ mostra, colpisci, zona: z });
      return; // una zona cliccata non avvia la presa
    }

    if (!afferra(x, y)) return;
    inMano = true;
    strappato = false;
    px = x; py = y;
    sx = x; sy = y; tPuntatore = 0; // il filtro riparte dal punto di presa
    canvas.style.cursor = 'grabbing';
    try { canvas.setPointerCapture?.(ev.pointerId); } catch {}
    ev.preventDefault();
    clearTimeout(timerStordito);
    reagisci('held');
    sveglia();
  };

  const onMove = (ev) => {
    const [x, y] = posizionePuntatore(ev);
    if (!inMano) {
      // il cursore dice che c'e' qualcosa da cliccare, altrimenti nessuno lo trova
      canvas.style.cursor = zonaSotto(x, y) ? 'pointer' : 'grab';
      return;
    }
    trascina(x, y);
    if (!strappato && spostamentoMax() > opt.pullSoglia) {
      strappato = true;
      reagisci('pulled');
    }
  };

  const onUp = () => {
    if (!inMano) return;
    lascia();
    // uno strappo lo lascia stordito per un attimo, una carezza no
    if (strappato && R.dazed) {
      reagisci('dazed');
      timerStordito = setTimeout(aRiposoFaccia, opt.dazedMs);
    } else {
      aRiposoFaccia();
    }
  };

  canvas.addEventListener('pointerenter', onEnter);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  const onLeave = (ev) => { onUp(ev); onLeaveSolo(); };
  canvas.addEventListener('pointerleave', onLeave);

  // ---- ciclo di disegno ---------------------------------------------------
  function ombreggia() {
    // compressione locale -> piu' scuro, stiramento -> piu' chiaro
    for (let i = 0; i < n; i++) {
      shadeArr[i] = Math.max(-0.5, Math.min(0.5, -(lapUx[i] + lapUy[i]) * opt.shade));
    }
  }

  // Il canvas si ridimensiona SOLO quando l'elemento cambia davvero di taglia.
  // Misurarlo a ogni frame e riassegnare canvas.width rialloca il buffer di
  // disegno ogni volta: basta che il layout oscilli di un pixel per far
  // crollare il frame rate.
  let daDimensionare = true;
  const ro = new ResizeObserver(() => { daDimensionare = true; sveglia(); });
  ro.observe(canvas);

  function dimensiona() {
    if (!daDimensionare) return;
    daDimensionare = false;
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) { daDimensionare = true; return; }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(r.width * dpr));
    const h = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  let raf = 0;
  let ultimo = performance.now();
  let vivo = true;
  let dorme = false;

  // `substeps` definisce la frequenza della simulazione: 4 -> 240 Hz.
  const PASSO_FISSO = 1 / (60 * Math.max(1, opt.substeps));
  let accumulo = 0;

  // Quando la foto e' tornata a riposo non c'e' niente da simulare ne' da
  // ridisegnare: il ciclo si ferma del tutto e riparte alla prima presa.
  // Senza questo il ritratto consuma CPU e batteria per sempre.
  const SOGLIA = 1e-5;
  function aRiposo() {
    for (let i = 0; i < n; i++) {
      if (ux[i] * ux[i] + uy[i] * uy[i] > SOGLIA) return false;
      if (vx[i] * vx[i] + vy[i] * vy[i] > SOGLIA) return false;
    }
    return true;
  }

  function sveglia() {
    if (!vivo || !dorme) return;
    dorme = false;
    ultimo = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function frame(ora) {
    if (!vivo) return;
    const dt = Math.min(0.05, (ora - ultimo) / 1000) || 0.016;
    ultimo = ora;

    // Passo fisso con accumulatore: la simulazione avanza sempre dello stesso
    // dt a prescindere dal frame rate. Con dt variabile la stessa trazione
    // produce una risposta diversa su 60 e su 144 Hz, e ai frame lunghi
    // l'integrazione esplicita diventa instabile — sono gli scatti che si
    // vedevano tirando la foto.
    accumulo = Math.min(accumulo + dt, 0.2); // dopo una pausa non recupera tutto
    let passi = 0;
    while (accumulo >= PASSO_FISSO && passi < 60) {
      passo(PASSO_FISSO);
      accumulo -= PASSO_FISSO;
      passi++;
    }
    ombreggia();

    for (let i = 0; i < n; i++) {
      posArr[i * 2] = restX[i] + ux[i];
      posArr[i * 2 + 1] = restY[i] + uy[i];
    }

    if (fadeT < 1) fadeT = Math.min(1, fadeT + dt / fadeDurata);

    dimensiona();
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture[facciaDa] || texture[nomeBase]);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, texture[facciaA] || texture[nomeBase]);
    // smoothstep sulla dissolvenza: niente stacchi netti in entrata e uscita
    gl.uniform1f(locMix, fadeT * fadeT * (3 - 2 * fadeT));

    gl.bindBuffer(gl.ARRAY_BUFFER, bufPos);
    gl.bufferData(gl.ARRAY_BUFFER, posArr, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(locPos);
    gl.vertexAttribPointer(locPos, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, bufUv);
    gl.enableVertexAttribArray(locUv);
    gl.vertexAttribPointer(locUv, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, bufShade);
    gl.bufferData(gl.ARRAY_BUFFER, shadeArr, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(locShade);
    gl.vertexAttribPointer(locShade, 1, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufIdx);
    gl.drawElements(gl.TRIANGLES, indiceArr.length, n > 65535 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);

    // questo fotogramma mostra gia' la foto a riposo: puo' essere l'ultimo.
    // Una dissolvenza in corso tiene sveglio il motore fino alla fine.
    if (!inMano && fadeT >= 1 && facciaA === nomeBase && aRiposo()) { dorme = true; return; }
    raf = requestAnimationFrame(frame);
  }

  // la foto resta nel DOM come fallback finche' il canvas non e' pronto
  const foto = host.querySelector('img');
  if (foto) foto.style.visibility = 'hidden';
  host.appendChild(canvas);
  dimensiona();
  raf = requestAnimationFrame(frame);

  return {
    canvas,
    opt,
    /** Nomi delle espressioni caricate. */
    facce: Object.keys(texture),
    /** Mostra un'espressione a comando, con dissolvenza. */
    mostra,
    /** Dà un colpo alla maglia in un punto UV. */
    colpisci,
    /**
     * Cambia a caldo la faccia a riposo e la mappa delle reazioni. Serve
     * quando l'interazione cambia stabilmente il personaggio — per esempio
     * dopo che gli hanno rubato l'orologio, tutte le facce successive devono
     * essere quelle col polso nudo.
     */
    cambiaSet({ rest, reactions }) {
      if (rest && texture[rest]) nomeBase = rest;
      if (reactions) R = reactions;
    },
    /** Regola un parametro a caldo (per il pannello di prova). */
    set(k, v) {
      opt[k] = v;
      ricalcola();
      sveglia();
    },
    /** Rimette la foto a riposo. */
    reset() {
      ux.fill(0); uy.fill(0); vx.fill(0); vy.fill(0); peso.fill(0);
      sveglia();
    },
    /** true quando il ciclo e' fermo perche' la foto e' a riposo. */
    get dorme() { return dorme; },
    /** Stato corrente delle espressioni, per diagnostica. */
    get stato() {
      return { da: facciaDa, a: facciaA, fade: +fadeT.toFixed(2), riposo: nomeBase };
    },
    /**
     * Costo reale di un passo di fisica, in millisecondi, misurato in modo
     * sincrono: non passa dal requestAnimationFrame, quindi la misura regge
     * anche dove il browser stroza i frame (schede in secondo piano).
     */
    bench(iterazioni = 300) {
      const su = ux.slice(), sv = vx.slice(), su2 = uy.slice(), sv2 = vy.slice();
      for (let i = 0; i < n; i++) if (!bordo[i]) { ux[i] = 0.01; uy[i] = 0.01; }
      const t0 = performance.now();
      for (let k = 0; k < iterazioni; k++) passo(1 / 180);
      const ms = (performance.now() - t0) / iterazioni;
      ux.set(su); vx.set(sv); uy.set(su2); vy.set(sv2);
      return { msPerPasso: +ms.toFixed(3), msPerFrame: +(ms * opt.substeps).toFixed(3), nodi: n };
    },
    destroy() {
      vivo = false;
      cancelAnimationFrame(raf);
      clearTimeout(timerStordito);
      ro.disconnect();
      canvas.removeEventListener('pointerenter', onEnter);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.remove();
      if (foto) foto.style.visibility = '';
    },
  };
}
