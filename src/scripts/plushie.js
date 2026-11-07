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
  /**
   * Margine attorno alla foto, in frazione del lato del canvas. La foto
   * occupa il centro e il resto resta libero: serve quando la deformazione
   * deve poter uscire da una cornice senza essere tagliata dal canvas.
   */
  pad: 0,
  /** Ingrandimento della foto dentro l'area disponibile (1 = com'e'). */
  zoom: 1,
  /** Spostamento della foto nell'area, in frazione del lato del canvas. */
  offsetX: 0,
  offsetY: 0,
  /**
   * Regioni deformabili, in UV dell'immagine: `[{x, y, r}]` oppure
   * `{x, y, rx, ry}` per un'ellisse. Fuori da queste i nodi sono fissi, cosi'
   * si puo' lasciare mobile solo la faccia e tenere il corpo una fotografia.
   * `null` = tutta l'immagine e' deformabile.
   */
  mobile: null,
  /**
   * Regione mobile a rampa verticale, per la testa intera: libera sopra `v1`
   * (UV), ferma sotto `v0`, con un passaggio dolce in mezzo; nella fascia
   * delle spalle si restringe in orizzontale (`xa`..`xb` dal centro `xc`).
   * Niente bordo netto: e' quello che fa sembrare il volto "a sezioni".
   *   { v0, v1, xc, xa, xb }
   */
  rampa: null,
  /** Perno attorno a cui la testa si inclina, in UV (il collo). */
  neck: { x: 0.5, y: 0.47 },
  /** Quanto la testa intera segue la mano (0 = solo la pelle si stira). */
  sway: 0.7,
  swayFreq: 8, // rad/s della molla di inclinazione
  swayZeta: 0.42, // smorzamento: sotto 1 ondeggia e si assesta
  /** Soglia di opacita' (0-255) sotto cui un punto e' vuoto e non si afferra. */
  opaco: 40,
  /** Quanto e' sfumato il bordo delle regioni, in frazione del raggio. */
  sfumatura: 0.38,
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

  // --- vita del volto (facoltative) ----------------------------------------
  // Regioni in UV: vedi src/data/ritratto.json. Senza, sguardo e battito sono
  // spenti e restano solo maglia ed espressioni.
  regioni: null,
  gazeIdleMs: 3000, // senza movimento del mouse lo sguardo torna in avanti
  blinkMin: 2600, // intervallo fra due battiti, ms
  blinkMax: 5800,
  // rabbia: `grabs` prese entro `windowMs` ms; poi resta per `holdMs` dal rilascio
  angry: { grabs: 4, windowMs: 9000, face: 'deadpan', holdMs: 2200 },
  hum: { face: 'deadpan' }, // faccia di base mentre canticchia
  // touch: tenere premuto o trascinare in orizzontale afferra; in verticale
  // scorre la pagina
  longPressMs: 380,

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

/**
 * Tutti gli effetti sul volto vivono qui, nello spazio UV della fotografia:
 * seguono la maglia da soli e non toccano la geometria. Nessuna faccia viene
 * inventata — si rimappano e si ricolorano pixel della foto stessa.
 *
 *   sguardo     il contenuto dell'apertura dell'occhio scorre di pochi pixel,
 *               con una rampa che lo tiene fermo ai bordi: l'iride non esce
 *               dall'orbita e le palpebre restano dove sono
 *   palpebra    un bordo che scende dentro l'ellisse dell'occhio e lo copre con
 *               la pelle della guancia, scurita, piu' una riga di ciglia
 *   sopracciglia il contenuto scende (di piu' verso il naso): cipiglio
 *   bocca       il contenuto si stringe in orizzontale: labbra raccolte
 *   rossore     una tinta calda sul solo ovale del viso
 */
const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D u_tex;   // faccia corrente
uniform sampler2D u_tex2;  // faccia in arrivo
uniform float u_mix;       // 0 = solo la corrente, 1 = solo quella in arrivo
uniform vec4  u_eyes;      // occhio sx (x,y), occhio dx (x,y)
uniform vec2  u_eyeR;      // semiassi dell'apertura dell'occhio
uniform vec2  u_gazeMax;   // scorrimento massimo del contenuto, in UV
uniform vec4  u_brows;     // sopracciglio sx (x,y), dx (x,y)
uniform vec2  u_browR;     // semiassi della zona sopracciglio
uniform vec4  u_mouth;     // centro (x,y), semiassi (z,w)
uniform vec4  u_face;      // centro (x,y), semiassi (z,w)
uniform vec2  u_gaze;      // -1..1, + = verso destra / basso nello schermo
uniform float u_blink;     // 0 aperto .. 1 chiuso
uniform float u_squint;    // 0..1 palpebra superiore socchiusa (rabbia)
uniform float u_brow;      // 0..1 cipiglio
uniform float u_hum;       // 0..1 labbra raccolte
uniform float u_flush;     // 0..1 rossore
uniform float u_time;
varying vec2 v_uv;
varying float v_shade;

float ell(vec2 p, vec2 c, vec2 r, float inner) {
  return 1.0 - smoothstep(inner, 1.0, length((p - c) / r));
}

vec4 tex(vec2 p) {
  return mix(texture2D(u_tex, p), texture2D(u_tex2, p), u_mix);
}

// Palpebra superiore che scende sull'occhio centrato in c. 'chiuso' va da 0
// (aperto) a 1 (chiuso). Restituisce il colore di partenza ritoccato.
vec3 palpebra(vec2 q, vec2 c, float chiuso, vec3 col) {
  if (chiuso < 0.003) return col;
  vec2 R = vec2(u_eyeR.x * 1.12, u_eyeR.y * 1.3);
  float m = 1.0 - smoothstep(0.74, 1.0, length((q - c) / R));
  float yTop = c.y - R.y;
  float yEdge = yTop + chiuso * 2.0 * R.y * 1.04;
  float coperto = smoothstep(yEdge + 0.0015, yEdge - 0.0015, q.y);
  // la pelle della palpebra e' quella appena sotto l'occhio, appena piu' scura
  vec3 pelle = tex(vec2(q.x, c.y + R.y * 1.9 + (q.y - yTop) * 0.2)).rgb * vec3(0.94, 0.89, 0.87);
  vec3 out_ = mix(col, pelle, m * coperto);
  // riga delle ciglia: segue il bordo e si ferma sulla linea d'occhio chiuso
  float dx = (q.x - c.x) / R.x;
  float yLine = min(yEdge, c.y + R.y * 0.3) + 0.18 * R.y * (1.0 - dx * dx);
  float ciglia = m * (1.0 - smoothstep(0.0, 0.0021, abs(q.y - yLine)));
  return out_ * (1.0 - 0.5 * ciglia * smoothstep(0.03, 0.25, chiuso));
}

void main() {
  vec2 p = v_uv;

  // cipiglio: sopracciglia che scendono, piu' dal lato del naso
  float bl = ell(v_uv, u_brows.xy, u_browR, 0.5);
  float br = ell(v_uv, u_brows.zw, u_browR, 0.5);
  float inL = smoothstep(0.43, 0.5, v_uv.x);
  float inR = 1.0 - smoothstep(0.53, 0.6, v_uv.x);
  p.y -= u_brow * (bl * (0.003 + 0.0055 * inL) + br * (0.003 + 0.0055 * inR));

  // sguardo: l'apertura dell'occhio scorre, il bordo resta fermo
  float gl = ell(v_uv, u_eyes.xy, u_eyeR, 0.5);
  float gr = ell(v_uv, u_eyes.zw, u_eyeR, 0.5);
  p -= u_gazeMax * u_gaze * (gl + gr);

  // labbra raccolte che oscillano appena: mugolio
  float mb = ell(v_uv, u_mouth.xy, u_mouth.zw, 0.35) * u_hum;
  p.x = u_mouth.x + (p.x - u_mouth.x) * (1.0 + 0.3 * mb);
  p.y += sin(u_time * 8.0) * 0.0012 * mb;

  vec4 c = tex(p);

  float chiuso = max(u_blink, u_squint);
  c.rgb = palpebra(v_uv, u_eyes.xy, chiuso, c.rgb);
  c.rgb = palpebra(v_uv, u_eyes.zw, chiuso, c.rgb);

  float viso = ell(v_uv, u_face.xy, u_face.zw, 0.3);
  c.rgb *= mix(vec3(1.0), vec3(1.12, 0.92, 0.9), u_flush * viso);

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

  // Maschera di opacita' della foto base: chi tocca lo sfondo trasparente non
  // afferra niente. Si legge una volta sola, a 256x256.
  const MA = 256;
  const alfa = new Uint8Array(MA * MA);
  {
    const c = document.createElement('canvas');
    c.width = c.height = MA;
    const x2 = c.getContext('2d', { willReadFrequently: true });
    x2.drawImage(img, 0, 0, MA, MA);
    const d = x2.getImageData(0, 0, MA, MA).data;
    for (let i = 0; i < MA * MA; i++) alfa[i] = d[i * 4 + 3];
  }
  const opaco = (u, v) => {
    const c = Math.round(u * (MA - 1)), r = Math.round(v * (MA - 1));
    return c >= 0 && r >= 0 && c < MA && r < MA && alfa[r * MA + c] >= opt.opaco;
  };

  const canvas = document.createElement('canvas');
  canvas.className = 'plush-canvas';
  // pan-y: lo scorrimento verticale resta alla pagina, l'orizzontale arriva a noi
  canvas.style.cssText =
    'display:block;width:100%;height:100%;touch-action:pan-y;cursor:grab;' +
    '-webkit-touch-callout:none;user-select:none;-webkit-user-select:none';
  canvas.setAttribute('aria-hidden', 'true'); // la semantica sta sull'host

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
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    // Le foto sono molto piu' grandi di come si vedono: senza mipmap la
    // riduzione sfarfalla appena la maglia si muove. WebGL1 vuole potenze di
    // due per le mipmap, quindi si ricampiona una volta sola al caricamento.
    const L = 1024;
    const tmp = document.createElement('canvas');
    tmp.width = tmp.height = L;
    const cx = tmp.getContext('2d');
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(im, 0, 0, L, L);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, tmp);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    tmp.width = tmp.height = 0; // rilascia la memoria del canvas d'appoggio
    texture[nome] = t;
  }

  const locTex = gl.getUniformLocation(prog, 'u_tex');
  const locTex2 = gl.getUniformLocation(prog, 'u_tex2');
  const locMix = gl.getUniformLocation(prog, 'u_mix');
  gl.uniform1i(locTex, 0);
  gl.uniform1i(locTex2, 1);

  // Uniform degli effetti sul volto, cercati una volta sola.
  const U = {};
  for (const k of [
    'eyes', 'eyeR', 'gazeMax', 'brows', 'browR', 'mouth', 'face',
    'gaze', 'blink', 'squint', 'brow', 'hum', 'flush', 'time',
  ]) U[k] = gl.getUniformLocation(prog, 'u_' + k);

  // Regioni del volto. Senza, le ellissi stanno fuori dall'immagine e ogni
  // effetto e' un no-op.
  const reg = opt.regioni;
  const fx = !!reg;
  if (fx) {
    const { occhi: o, sopracciglia: s, bocca: b, viso: v } = reg;
    gl.uniform4f(U.eyes, o.sx.x, o.sx.y, o.dx.x, o.dx.y);
    gl.uniform2f(U.eyeR, o.semiassi.rx, o.semiassi.ry);
    gl.uniform2f(U.gazeMax, o.sguardoMax.x, o.sguardoMax.y);
    gl.uniform4f(U.brows, s.sx.x, s.sx.y, s.dx.x, s.dx.y);
    gl.uniform2f(U.browR, s.semiassi.rx, s.semiassi.ry);
    gl.uniform4f(U.mouth, b.x, b.y, b.rx, b.ry);
    gl.uniform4f(U.face, v.x, v.y, v.rx, v.ry);
  } else {
    gl.uniform4f(U.eyes, -9, -9, -9, -9);
    gl.uniform2f(U.eyeR, 1, 1);
    gl.uniform2f(U.gazeMax, 0, 0);
    gl.uniform4f(U.brows, -9, -9, -9, -9);
    gl.uniform2f(U.browR, 1, 1);
    gl.uniform4f(U.mouth, -9, -9, 1, 1);
    gl.uniform4f(U.face, -9, -9, 1, 1);
  }

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

  // La foto occupa il quadrato centrale; `pad` e' il margine lasciato libero
  // tutt'intorno perche' la deformazione possa uscire dalla cornice.
  const pad = Math.max(0, Math.min(0.45, opt.pad));
  // Un'unica trasformazione UV -> canvas, usata anche da zone, regioni mobili
  // e presa: se queste divergessero, i punti cliccabili finirebbero altrove
  // rispetto a quello che si vede.
  const scala = (1 - 2 * pad) * opt.zoom;
  const uvAx = (u) => 0.5 + (u - 0.5) * scala + opt.offsetX;
  const uvAy = (v) => 0.5 + (v - 0.5) * scala + opt.offsetY;
  const xAu = (x) => (x - 0.5 - opt.offsetX) / scala + 0.5;
  const yAv = (y) => (y - 0.5 - opt.offsetY) / scala + 0.5;

  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const i = idx(r, c);
      const u = c / (N - 1);
      const v = r / (N - 1);
      restX[i] = uvAx(u); // posizione sul canvas
      restY[i] = uvAy(v);
      uvArr[i * 2] = u; // punto della texture: sempre 0..1
      uvArr[i * 2 + 1] = v;
      if (r === 0 || c === 0 || r === N - 1 || c === N - 1) bordo[i] = 1;
    }
  }

  /**
   * Quanto ogni nodo e' libero di muoversi: 1 dentro una regione mobile, 0
   * fuori, con una rampa in mezzo. Senza la rampa il confine fra parte mobile
   * e parte fissa produce uno strappo netto e ben visibile.
   */
  const libero = new Float32Array(n);
  if (!opt.mobile || !opt.mobile.length) {
    if (!opt.rampa) libero.fill(1); // ne' ellissi ne' rampa: tutta l'immagine
  } else {
    const regioni = opt.mobile.map((z) => ({
      x: z.x, y: z.y, rx: z.rx ?? z.r, ry: z.ry ?? z.r,
    }));
    const f = Math.max(0.01, Math.min(0.9, opt.sfumatura));
    for (let i = 0; i < n; i++) {
      // le regioni sono in UV: confronto con la posizione a riposo in UV
      const u = xAu(restX[i]);
      const v = yAv(restY[i]);
      let w = 0;
      for (const z of regioni) {
        const dx = (u - z.x) / z.rx, dy = (v - z.y) / z.ry;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d >= 1) continue;
        const t = Math.min(1, (1 - d) / f);
        w = Math.max(w, t * t * (3 - 2 * t)); // smoothstep
      }
      libero[i] = w;
    }
  }

  // Peso con cui la testa intera si inclina: solo la rampa, mai le ellissi
  // (l'orologio non deve ruotare attorno al collo).
  const pesoSway = new Float32Array(n);
  if (opt.rampa) {
    const q = opt.rampa;
    const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    for (let i = 0; i < n; i++) {
      const u = xAu(restX[i]), v = yAv(restY[i]);
      const wv = 1 - sm(q.v1, q.v0, v);
      const wh = 1 - (1 - (1 - sm(q.xa, q.xb, Math.abs(u - q.xc)))) * sm(q.v1 - 0.06, q.v1 + 0.06, v);
      const w = wv * wh;
      pesoSway[i] = w;
      if (w > libero[i]) libero[i] = w;
    }
  }

  // I triangoli si disegnano nell'ordine dell'indice, e non c'e' profondita':
  // l'ultimo disegnato sta sopra. Quelli fermi vanno quindi PRIMA, cosi' la
  // faccia tirata passa sopra al corpo invece di finirci sotto.
  const fissi = [];
  const mobili = [];
  for (let r = 0; r < N - 1; r++) {
    for (let c = 0; c < N - 1; c++) {
      const a = idx(r, c), b = idx(r, c + 1), d = idx(r + 1, c), e = idx(r + 1, c + 1);
      const vivo = libero[a] > 0 || libero[b] > 0 || libero[d] > 0 || libero[e] > 0;
      (vivo ? mobili : fissi).push(a, b, d, b, e, d);
    }
  }
  const indici = fissi.concat(mobili);
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

  // Limite morbido allo stiramento: fino al ginocchio nulla cambia, oltre la
  // curva si appiattisce verso maxPull. Un taglio netto fa scattare e piegare
  // la maglia; una curva continua fa sentire la gomma che oppone resistenza.
  function limita(i) {
    // Verso il basso la testa va a sovrapporsi al corpo fermo, e il collo non
    // si comprime come si allunga: li' il limite e' molto piu' severo, e
    // prima che la maglia si ripieghi su se stessa.
    if (uy[i] > 0) {
      const kd = opt.maxPull * 0.12, qd = opt.maxPull * 0.3;
      if (uy[i] > kd) {
        const e = Math.exp(-2 * (uy[i] - kd) / qd);
        uy[i] = kd + qd * (1 - e) / (1 + e);
      }
      if (vy[i] > 0 && uy[i] > kd) vy[i] *= 0.6; // la velocita' si spegne contro il limite
    }
    const m2 = ux[i] * ux[i] + uy[i] * uy[i];
    const k = opt.maxPull * 0.5;
    if (m2 <= k * k) return;
    const m = Math.sqrt(m2);
    const q = opt.maxPull - k;
    const e = Math.exp(-2 * (m - k) / q);
    const nm = k + q * (1 - e) / (1 + e); // k + q*tanh((m-k)/q)
    const f = nm / m;
    ux[i] *= f; uy[i] *= f;
  }

  // ---- inclinazione della testa -----------------------------------------------
  // Oltre alla pelle che si stira, la testa intera ruota attorno al collo e si
  // sposta un po' verso la mano, trattenuta da una molla. E' lei a far sembrare
  // il volto un unico oggetto morbido invece di una toppa sulla foto.
  const sw = { th: 0, vth: 0, ty: 0, vty: 0, thT: 0, tyT: 0, leva: 0.3 };
  const pivX = uvAx(opt.neck.x), pivY = uvAy(opt.neck.y);
  const haSway = !!opt.rampa && opt.sway > 0;

  function molla(dt) {
    if (!haSway) return;
    const w = opt.swayFreq, z = opt.swayZeta;
    sw.vth += (w * w * (sw.thT - sw.th) - 2 * z * w * sw.vth) * dt;
    sw.th += sw.vth * dt;
    sw.vty += (w * w * (sw.tyT - sw.ty) - 2 * z * w * sw.vty) * dt;
    sw.ty += sw.vty * dt;
  }
  const swayAttivo = () =>
    Math.abs(sw.th) > 1e-4 || Math.abs(sw.vth) > 1e-3 || Math.abs(sw.ty) > 1e-4 ||
    Math.abs(sw.vty) > 1e-3 || Math.abs(sw.thT) > 1e-4 || Math.abs(sw.tyT) > 1e-4;

  function passo(dt) {
    molla(dt);
    laplaciani();
    for (let i = 0; i < n; i++) {
      // fuori dalle regioni mobili il nodo e' inchiodato: il corpo resta
      // una fotografia e l'onda non lo attraversa
      if (libero[i] <= 0 || (bordo[i] && opt.pinBorder)) {
        ux[i] = uy[i] = vx[i] = vy[i] = 0;
        continue;
      }
      if (peso[i] > 0) continue; // i nodi in mano li comanda il puntatore
      const ax = c2 * lapUx[i] - w2 * ux[i] - opt.damping * vx[i] + nu * lapVx[i];
      const ay = c2 * lapUy[i] - w2 * uy[i] - opt.damping * vy[i] + nu * lapVy[i];
      vx[i] += ax * dt;
      vy[i] += ay * dt;
      ux[i] += vx[i] * dt;
      uy[i] += vy[i] * dt;
      limita(i);
    }
  }

  // ---- presa --------------------------------------------------------------
  let inMano = false;
  let px = 0, py = 0;

  function posizionePuntatore(ev) {
    const r = canvas.getBoundingClientRect();
    return [(ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height];
  }

  /** Quanto e' mobile il punto del canvas sotto il puntatore. */
  function liberoIn(x, y) {
    const c = Math.round(xAu(x) * (N - 1));
    const r = Math.round(yAv(y) * (N - 1));
    if (c < 0 || r < 0 || c >= N || r >= N) return 0;
    // lo sfondo trasparente non risponde, anche dentro la regione mobile
    if (!opaco(xAu(x), yAv(y))) return 0;
    return libero[idx(r, c)];
  }

  function afferra(x, y) {
    // La presa deve COMINCIARE su una zona mobile. Senza questo controllo il
    // raggio della mano arriva a pescare nodi liberi anche partendo da un
    // punto fermo del corpo, e il corpo sembra afferrabile da lontano.
    if (liberoIn(x, y) < 0.05) return false;

    // la mano copre la stessa porzione di faccia a prescindere da `pad`
    const R = opt.grabRadius * scala, R2 = R * R;
    let presi = 0;
    for (let i = 0; i < n; i++) {
      if (libero[i] <= 0 || (bordo[i] && opt.pinBorder)) { peso[i] = 0; continue; }
      // la mano vive nell'immagine deformata
      const dx = restX[i] + ux[i] - x;
      const dy = restY[i] + uy[i] - y;
      const d2 = dx * dx + dy * dy;
      if (d2 > R2) { peso[i] = 0; continue; }
      const t = 1 - Math.sqrt(d2) / R;
      // la rampa di `libero` smussa il confine col corpo fermo
      peso[i] = t * t * (3 - 2 * t) * libero[i];
      if (peso[i] > 0.01) presi++;
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

    // parte del movimento va alla testa intera (vedi molla): la pelle sotto
    // la mano ne prende il resto, cosi' la somma resta quella del puntatore
    const gain = haSway ? 1 - 0.45 * opt.sway : 1;
    let sW = 0, sUx = 0, sUy = 0;
    for (let i = 0; i < n; i++) {
      const w = peso[i];
      if (w <= 0) continue;
      ux[i] += dx * w * gain;
      uy[i] += dy * w * gain;
      sW += w; sUx += ux[i] * w; sUy += uy[i] * w;
      limita(i);
      // la mano imprime velocita' vera: al rilascio il rimbalzo ha senso
      vx[i] = dx * w * invDt;
      vy[i] = dy * w * invDt;
    }
    px = sx; py = sy;
    if (haSway && sW > 0) {
      // spostamento medio della presa -> inclinazione e trazione verticale
      const mx = sUx / sW, my = sUy / sW;
      const k = opt.sway;
      sw.thT = Math.max(-0.3, Math.min(0.3, (k * 0.9 * mx) / sw.leva));
      sw.tyT = Math.max(-0.05, Math.min(0.012, k * 0.35 * my)); // in giu' pochissimo
    }
    sveglia();
  }

  function lascia() {
    inMano = false;
    sw.thT = 0; sw.tyT = 0; // la molla riporta la testa a riposo, con un po' di rimbalzo
    peso.fill(0);
    canvas.style.cursor = 'grab';
  }

  // ---- eventi verso l'esterno ----------------------------------------------
  const ascoltatori = {};
  const emetti = (nome, dati) => (ascoltatori[nome] || []).forEach((f) => f(dati));

  // ---- visibilita': fuori dal viewport o a scheda nascosta non si disegna ---
  let visibile = true;
  const attivo = () => visibile && !document.hidden;

  // ---- emozioni: parametri continui per lo shader ---------------------------
  // Ogni parametro insegue il suo bersaglio con un filtro esponenziale, cosi'
  // nessuna espressione scatta: entra e esce in ~300 ms.
  const emo = { brow: 0, squint: 0, flush: 0, hum: 0 };
  const emoT = { brow: 0, squint: 0, flush: 0, hum: 0 };
  let modo = null; // 'angry' | 'hum' | null
  let timerRabbia = 0;
  let tTempo = 0;

  function aggiornaEmozioni(dt) {
    const a = 1 - Math.exp(-dt * 7);
    for (const k in emo) emo[k] += (emoT[k] - emo[k]) * a;
  }
  const emoAttiva = () => {
    for (const k in emo) if (Math.abs(emoT[k] - emo[k]) > 0.004 || emo[k] > 0.004) return true;
    return false;
  };

  // ---- sguardo --------------------------------------------------------------
  let mouseX = 0, mouseY = 0, tMouse = -1e9;
  let forzato = null; // {x, y} in coordinate client: es. la farfalla
  let gx = 0, gy = 0;
  let timerSguardo = 0;
  let rettangolo = null; // rect del canvas, aggiornato a ogni fotogramma

  // Punto del volto in coordinate client, comprensivo della deformazione.
  const _p = [0, 0];
  function punto(u, v) {
    const r = rettangolo || canvas.getBoundingClientRect();
    const c = Math.max(0, Math.min(N - 1, Math.round(u * (N - 1))));
    const w = Math.max(0, Math.min(N - 1, Math.round(v * (N - 1))));
    const i = idx(w, c);
    _p[0] = r.left + (uvAx(u) + ux[i]) * r.width;
    _p[1] = r.top + (uvAy(v) + uy[i]) * r.height;
    return _p;
  }

  function aggiornaSguardo(dt, ora) {
    let tx = 0, ty = 0, segue = false;
    const meta = forzato || (ora - tMouse < opt.gazeIdleMs ? { x: mouseX, y: mouseY } : null);
    if (fx && meta) {
      const o = reg.occhi;
      const p = punto((o.sx.x + o.dx.x) / 2, (o.sx.y + o.dx.y) / 2);
      const dx = meta.x - p[0], dy = meta.y - p[1];
      const d = Math.hypot(dx, dy);
      const portata = Math.max(60, (rettangolo || canvas.getBoundingClientRect()).width * 0.45);
      if (d > 1) { const k = Math.min(1, d / portata) / d; tx = dx * k; ty = dy * k; }
      segue = true;
    }
    // verso un bersaglio e' svelto, il ritorno in avanti piu' lento
    const a = 1 - Math.exp(-dt * (segue ? 14 : 4));
    gx += (tx - gx) * a;
    gy += (ty - gy) * a;
  }
  const sguardoAttivo = () => {
    if (!fx) return false;
    if (forzato) return true;
    return Math.abs(gx) > 0.003 || Math.abs(gy) > 0.003;
  };

  const onMouseGlobale = (ev) => {
    if (ev.pointerType === 'touch' || !fx) return;
    mouseX = ev.clientX; mouseY = ev.clientY;
    tMouse = performance.now();
    // dopo gazeIdleMs di quiete lo sguardo torna in avanti
    clearTimeout(timerSguardo);
    timerSguardo = setTimeout(sveglia, opt.gazeIdleMs + 40);
    sveglia();
  };
  window.addEventListener('pointermove', onMouseGlobale, { passive: true });

  // ---- battito --------------------------------------------------------------
  // chiusura 75 ms, pausa 30, apertura 150: la palpebra scende piu' in fretta
  // di quanto risale
  let blinkT0 = -1, blinkV = 0, timerBlink = 0;
  let blinkFisso = 0; // solo per le prove: tiene la palpebra a un valore
  const easeIn = (t) => t * t;
  const easeOut = (t) => 1 - (1 - t) * (1 - t);

  function aggiornaBlink(ora) {
    if (blinkT0 < 0) { blinkV = blinkFisso; return; }
    const e = ora - blinkT0;
    if (e < 75) blinkV = easeIn(e / 75);
    else if (e < 105) blinkV = 1;
    else if (e < 255) blinkV = 1 - easeOut((e - 105) / 150);
    else { blinkV = 0; blinkT0 = -1; }
  }
  function parpebra() {
    if (!fx || !attivo()) return;
    blinkT0 = performance.now();
    sveglia();
  }
  function programmaBlink() {
    clearTimeout(timerBlink);
    const attesa = opt.blinkMin + Math.random() * (opt.blinkMax - opt.blinkMin);
    timerBlink = setTimeout(() => {
      parpebra();
      // ogni tanto un doppio battito
      if (Math.random() < 0.12) setTimeout(parpebra, 330);
      programmaBlink();
    }, attesa);
  }
  if (fx) programmaBlink();

  // ---- rabbia e canto -------------------------------------------------------
  const prese = []; // istanti delle prese recenti

  function arrabbia() {
    modo = 'angry';
    emoT.brow = 1; emoT.squint = 0.32; emoT.flush = 1; emoT.hum = 0;
    mostra(opt.angry.face, opt.fade);
    emetti('stato', 'angry');
    sveglia();
  }
  function calma() {
    if (modo !== 'angry') return;
    modo = null;
    emoT.brow = 0; emoT.squint = 0; emoT.flush = 0;
    aRiposoFaccia();
    emetti('stato', 'neutral');
    sveglia();
  }
  function canta(on) {
    if (on) {
      if (modo === 'angry') return;
      modo = 'hum';
      emoT.hum = 1;
      mostra(opt.hum.face, opt.fade);
      emetti('stato', 'hum');
    } else if (modo === 'hum') {
      modo = null;
      emoT.hum = 0;
      aRiposoFaccia();
      emetti('stato', 'neutral');
    }
    sveglia();
  }

  // ---- espressioni: dallo stato dell'interazione alla faccia --------------
  let R = opt.reactions || {};
  const scegli = (v) => (Array.isArray(v) ? v[(Math.random() * v.length) | 0] : v);
  let timerStordito = 0;
  let sopra = false;
  let strappato = false;

  function reagisci(stato) {
    // rabbia e canto comandano la faccia: le reazioni normali aspettano
    if (modo) return;
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
      // la zona e' data in UV dell'immagine: va portata in coordinate canvas,
      // che con `pad` non coincidono piu'
      const zx = uvAx(z.x) + ux[i], zy = uvAy(z.y) + uy[i];
      const rr = z.r * scala;
      if ((x - zx) ** 2 + (y - zy) ** 2 <= rr * rr) return z;
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
      if (libero[i] <= 0 || (bordo[i] && opt.pinBorder)) continue;
      const dx = restX[i] - x, dy = restY[i] - y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > raggio) continue;
      const w = 1 - d / raggio;
      const k = forza * w * w * libero[i];
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
      colpisci(uvAx(z.x), uvAy(z.y), z.forza ?? 0.5, 0.1 * scala);
      z.onHit?.({ mostra, colpisci, zona: z });
      return; // una zona cliccata non avvia la presa
    }

    if (ev.pointerType === 'touch') {
      // Su touch una pressione non afferra subito: potrebbe essere l'inizio di
      // uno scorrimento. Si afferra con la pressione lunga o con un
      // trascinamento deliberatamente orizzontale; in verticale scorre la pagina.
      if (liberoIn(x, y) < 0.05) return;
      annullaAttesa();
      // un colpetto subito: il ritratto risponde al tocco anche prima di
      // sapere se sara' una presa, uno scroll o un semplice tocco
      colpisci(x, y, 0.22, 0.09 * scala);
      attesa = {
        id: ev.pointerId, x, y, cx: ev.clientX, cy: ev.clientY,
        timer: setTimeout(() => iniziaPresa(attesa.id, attesa.x, attesa.y, true), opt.longPressMs),
      };
      return;
    }
    ev.preventDefault();
    iniziaPresa(ev.pointerId, x, y);
  };

  // pressione touch in attesa di capire cosa vuole fare
  let attesa = null;
  function annullaAttesa() {
    if (attesa) { clearTimeout(attesa.timer); attesa = null; }
  }

  function iniziaPresa(pointerId, x, y, lunga = false) {
    annullaAttesa();
    if (!afferra(x, y)) return;
    inMano = true;
    strappato = false;
    px = x; py = y;
    sx = x; sy = y; tPuntatore = 0; // il filtro riparte dal punto di presa
    sw.leva = Math.max(0.12, Math.hypot(x - pivX, y - pivY)); // braccio della rotazione
    canvas.style.cursor = 'grabbing';
    try { canvas.setPointerCapture?.(pointerId); } catch {}
    if (lunga) navigator.vibrate?.(8);
    clearTimeout(timerStordito);

    // Prese ravvicinate: la quarta entro windowMs fa arrabbiare
    const ora = performance.now();
    prese.push(ora);
    while (prese.length && ora - prese[0] > opt.angry.windowMs) prese.shift();
    emetti('grab', { n: prese.length });
    if (modo === 'hum') canta(false);
    if (prese.length >= opt.angry.grabs && fx) {
      prese.length = 0;
      clearTimeout(timerRabbia);
      arrabbia();
    } else {
      reagisci('held');
      if (!modo) emetti('stato', 'surprised');
    }
    sveglia();
  }

  // durante una presa touch il browser non deve far scorrere la pagina
  const onTouchMove = (e) => { if (inMano && e.cancelable) e.preventDefault(); };
  canvas.addEventListener('touchmove', onTouchMove, { passive: false });
  const onMenu = (e) => { if (inMano || attesa) e.preventDefault(); };
  canvas.addEventListener('contextmenu', onMenu);

  const onMove = (ev) => {
    const [x, y] = posizionePuntatore(ev);
    if (attesa && ev.pointerId === attesa.id) {
      const dx = Math.abs(ev.clientX - attesa.cx), dy = Math.abs(ev.clientY - attesa.cy);
      // orizzontale = presa; verticale = scroll della pagina. Finche' il dito
      // non ha deciso (meno di 10 px) si aspetta: annullare qui, tra due
      // soglie diverse, faceva fallire la presa con un dito lento.
      if (dx > 10 && dx > dy * 1.2) iniziaPresa(ev.pointerId, attesa.x, attesa.y);
      else if (dy > 10) annullaAttesa();
      if (!inMano) return;
    }
    if (!inMano) {
      // il cursore dice dove si puo' agire: cliccabile, afferrabile, o niente
      canvas.style.cursor = zonaSotto(x, y)
        ? 'pointer'
        : liberoIn(x, y) >= 0.05
          ? 'grab'
          : 'default';
      return;
    }
    trascina(x, y);
    if (!strappato && spostamentoMax() > opt.pullSoglia) {
      strappato = true;
      reagisci('pulled');
      if (!modo) emetti('stato', 'pain');
    }
  };

  const onUp = () => {
    annullaAttesa();
    if (!inMano) return;
    lascia();
    emetti('release');
    if (modo === 'angry') {
      // arrabbiato: niente stordimento, il broncio dura ancora un poco
      clearTimeout(timerRabbia);
      timerRabbia = setTimeout(calma, opt.angry.holdMs);
    } else if (strappato && R.dazed) {
      // uno strappo lo lascia stordito per un attimo, una carezza no
      reagisci('dazed');
      emetti('stato', 'dazed');
      timerStordito = setTimeout(() => { aRiposoFaccia(); emetti('stato', 'neutral'); }, opt.dazedMs);
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
    if (!vivo || !dorme || !attivo()) return;
    dorme = false;
    ultimo = performance.now();
    raf = requestAnimationFrame(frame);
  }

  // Fuori dal viewport o a scheda nascosta il ciclo si ferma e non consuma GPU.
  const io = new IntersectionObserver(
    (voci) => {
      visibile = voci[voci.length - 1].isIntersecting;
      emetti('visibile', visibile);
      if (visibile) sveglia();
    },
    { threshold: 0.05 }
  );
  io.observe(host);
  const onVisDoc = () => { if (!document.hidden) sveglia(); emetti('visibile', attivo()); };
  document.addEventListener('visibilitychange', onVisDoc);

  /** Rimette a zero lo spostamento: la geometria originale, esatta. */
  function azzera() {
    let c = false;
    for (let i = 0; i < n; i++) {
      if (ux[i] || uy[i] || vx[i] || vy[i]) c = true;
      ux[i] = uy[i] = vx[i] = vy[i] = 0;
    }
    return c;
  }

  function frame(ora) {
    if (!vivo) return;
    if (!attivo()) { dorme = true; return; }
    const dt = Math.min(0.05, (ora - ultimo) / 1000) || 0.016;
    ultimo = ora;
    tTempo += dt;
    rettangolo = canvas.getBoundingClientRect();
    aggiornaBlink(performance.now());
    aggiornaSguardo(dt, performance.now());
    aggiornaEmozioni(dt);

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
    // Il resto, che non basta per un passo intero, si integra comunque con un
    // passo piu' corto: senza, su monitor a 90/120/144 Hz la maglia avanza a
    // scatti alterni di uno e due passi e il movimento "tremola".
    if (accumulo > 0.0005) { passo(accumulo); accumulo = 0; }
    ombreggia();

    if (haSway && (sw.th || sw.ty)) {
      for (let i = 0; i < n; i++) {
        const ws = pesoSway[i];
        const rx = restX[i] - pivX, ry = restY[i] - pivY;
        posArr[i * 2] = restX[i] + ux[i] - sw.th * ry * ws;
        posArr[i * 2 + 1] = restY[i] + uy[i] + (sw.th * rx + sw.ty) * ws;
      }
    } else {
      for (let i = 0; i < n; i++) {
        posArr[i * 2] = restX[i] + ux[i];
        posArr[i * 2 + 1] = restY[i] + uy[i];
      }
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
    gl.uniform2f(U.gaze, gx, gy);
    gl.uniform1f(U.blink, blinkV);
    gl.uniform1f(U.squint, emo.squint);
    gl.uniform1f(U.brow, emo.brow);
    gl.uniform1f(U.hum, emo.hum);
    gl.uniform1f(U.flush, emo.flush);
    gl.uniform1f(U.time, tTempo);

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
    const fermo =
      !inMano && fadeT >= 1 && (facciaA === nomeBase || modo) && aRiposo() &&
      blinkT0 < 0 && !emoAttiva() && !sguardoAttivo() && modo !== 'hum' && !swayAttivo();
    if (fermo) {
      // un ultimo fotogramma con lo spostamento esattamente nullo: la foto
      // torna alla geometria originale, non a "quasi"
      if (azzera()) { raf = requestAnimationFrame(frame); return; }
      sw.th = sw.vth = sw.ty = sw.vty = 0;
      dorme = true;
      return;
    }
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
    /** Un battito di ciglia a comando (tastiera). */
    parpebra,
    /** Fa guardare un punto in coordinate client; `null` torna al mouse. */
    guarda(x, y) {
      forzato = x == null ? null : { x, y };
      sveglia();
    },
    /** Labbra raccolte: il mugolio. */
    canta,
    /** Punto UV del volto in coordinate client, deformazione compresa. */
    punto: (u, v) => { rettangolo = canvas.getBoundingClientRect(); return punto(u, v); },
    /** Eventi: 'grab', 'release', 'stato' (surprised|pain|dazed|angry|hum|neutral), 'visibile'. */
    on(nome, f) { (ascoltatori[nome] ||= []).push(f); },
    get visibile() { return attivo(); },
    /** Parametri di prova per gli effetti sul volto. */
    fx(p) {
      const { blink, ...resto } = p;
      Object.assign(emoT, resto);
      if (blink != null) { blinkT0 = -1; blinkFisso = blink; }
      sveglia();
      return { ...emo, blink: blinkV, gx, gy, modo };
    },
    /**
     * Riporta tutto allo stato originale: maglia, espressione, sguardo,
     * orologio. Serve al tasto Esc.
     */
    ripristina() {
      azzera(); peso.fill(0); inMano = false; annullaAttesa();
      sw.th = sw.vth = sw.ty = sw.vty = sw.thT = sw.tyT = 0;
      clearTimeout(timerRabbia); clearTimeout(timerStordito);
      modo = null; prese.length = 0;
      for (const k in emoT) emoT[k] = 0;
      forzato = null; tMouse = -1e9; gx = gy = 0;
      zone.forEach((z) => { z.usata = false; });
      nomeBase = opt.rest || Object.keys(facce)[0];
      R = opt.reactions || {};
      mostra(nomeBase, 0);
      facciaDa = facciaA = nomeBase;
      emetti('stato', 'neutral');
      sveglia();
    },
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
      clearTimeout(timerBlink);
      clearTimeout(timerSguardo);
      clearTimeout(timerRabbia);
      annullaAttesa();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVisDoc);
      window.removeEventListener('pointermove', onMouseGlobale);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('contextmenu', onMenu);
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
