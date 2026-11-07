/**
 * Farfalla dell'hero. Vola attorno al ritratto, si ferma sopra la testa
 * (il ritratto la segue con gli occhi), poi raggiunge una parola del titolo e vi si posa di lato.
 *
 * Macchina a stati, indipendente dal motore del ritratto:
 *
 *   inattiva -> entra -> sosta -> parola -> atterra -> posata
 *                  \________\________\_________\_____ fugge  (se si afferra il ritratto)
 *
 * Il tempo avanza a dt accumulato: se la scheda o l'hero escono dalla vista la
 * sequenza si ferma e riprende da dove era.
 *
 * Il punto di atterraggio si legge ogni fotogramma dal rettangolo reale della
 * parola, quindi segue scroll, ridimensionamenti e a capo diversi per schermo.
 * Una volta posata, la farfalla diventa figlia della parola e si muove con lei.
 */

const SVG = `
<svg viewBox="0 0 100 100" width="40" height="40" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="fc-ala-g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f7c65a"/>
      <stop offset="1" stop-color="#d4691a"/>
    </linearGradient>
    <g id="fc-ala-d">
      <path d="M50 46 C58 26 78 8 93 13 C99 16 97 31 90 43 C83 51 66 53 50 50 Z"
            fill="url(#fc-ala-g)" stroke="#2b1a0d" stroke-width="2.4" stroke-linejoin="round"/>
      <path d="M50 51 C67 53 83 59 85 73 C86 86 70 90 62 81 C56 75 52 63 50 56 Z"
            fill="url(#fc-ala-g)" stroke="#2b1a0d" stroke-width="2.4" stroke-linejoin="round"/>
      <path d="M52 48 C64 38 76 26 88 18 M54 51 C68 49 80 45 90 38 M54 56 C66 60 76 68 80 78"
            fill="none" stroke="#2b1a0d" stroke-width="1.3" opacity=".7"/>
      <circle cx="87" cy="21" r="2.2" fill="#fff7e0"/><circle cx="93" cy="30" r="1.8" fill="#fff7e0"/>
      <circle cx="80" cy="82" r="2" fill="#fff7e0"/><circle cx="73" cy="85" r="1.6" fill="#fff7e0"/>
    </g>
  </defs>
  <g class="ala ala-s"><use href="#fc-ala-d" transform="translate(100 0) scale(-1 1)"/></g>
  <g class="ala ala-d"><use href="#fc-ala-d"/></g>
  <ellipse cx="50" cy="52" rx="2.6" ry="17" fill="#1d120a"/>
  <circle cx="50" cy="34" r="3.2" fill="#1d120a"/>
  <path d="M49 32 C46 24 43 20 39 17 M51 32 C54 24 57 20 61 17"
        fill="none" stroke="#1d120a" stroke-width="1.2" stroke-linecap="round"/>
</svg>`;

const CSS = `
.fc-fly{position:fixed;inset:0;z-index:45;pointer-events:none;overflow:hidden}
.fc-farfalla{position:fixed;left:0;top:0;width:40px;height:40px;pointer-events:none;will-change:transform;
  filter:drop-shadow(0 3px 4px rgba(0,0,0,.35))}
.fc-farfalla svg{display:block}
.fc-farfalla .ala{transform-box:view-box;transform-origin:50px 50px}
.fc-farfalla.posata{position:absolute;left:58%;top:20%;margin:-20px 0 0 -20px;transform:rotate(22deg)!important;
  filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))}
.fc-farfalla.posata .ala{animation:fc-ala-riposo 5.5s ease-in-out infinite}
@keyframes fc-ala-riposo{0%,78%,100%{transform:scaleX(.16)}86%{transform:scaleX(.6)}92%{transform:scaleX(.22)}}
`;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const eio = (t) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(t, 0, 1));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
// differenza angolare piu' breve, in gradi
const dAng = (a, b) => ((((b - a) % 360) + 540) % 360) - 180;

function catmull(p0, p1, p2, p3, t, out) {
  const t2 = t * t, t3 = t2 * t;
  for (let k = 0; k < 2; k++) {
    out[k] = 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t +
      (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 +
      (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
  }
}

export function creaFarfalla({ plush, host, parola, punti, onStato }) {
  if (!document.getElementById('fc-farfalla-css')) {
    const st = document.createElement('style');
    st.id = 'fc-farfalla-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  const layer = document.createElement('div');
  layer.className = 'fc-fly';
  layer.setAttribute('aria-hidden', 'true');
  const sprite = document.createElement('div');
  sprite.className = 'fc-farfalla';
  sprite.innerHTML = SVG;
  sprite.style.display = 'none';
  layer.appendChild(sprite);
  document.body.appendChild(layer);
  const alaS = sprite.querySelector('.ala-s');
  const alaD = sprite.querySelector('.ala-d');

  // ---- stato -------------------------------------------------------------
  let fase = 'inattiva';
  let t = 0; // tempo nella fase, secondi
  let tot = 0; // tempo totale di volo (per l'ondeggiare)
  let x = 0, y = 0; // posizione corrente, coordinate client
  let rot = 0; // gradi, 0 = verso l'alto
  let flap = 0; // fase di battito
  let piega = 0; // 0 ali aperte .. 1 ali chiuse
  let raf = 0, ultimo = 0, sospesa = false;
  let timerStart = 0;
  let tentativi = 0;

  // percorso di avvicinamento, in coordinate normalizzate sul ritratto
  let poly = [], cum = [], lung = 0, durataEntra = 4, ip = 0;
  let p0x = 0, p0y = 0, durataParola = 2.4, fugaVx = 0, fugaVy = 0, fugaV = 0;
  const tmp = [0, 0];

  const rect = () => host.getBoundingClientRect();

  // ---- percorso attorno al ritratto ----------------------------------------
  function costruisciPercorso() {
    const r = rect();
    const W = r.width, H = r.height;
    const nx = (cx) => (cx - r.left) / W;
    const ny = (cy) => (cy - r.top) / H;
    const pts = [];
    // entra da destra, all'altezza della spalla
    pts.push([nx(window.innerWidth + 60), 0.42]);
    // ... e gira attorno al disco in senso orario fino alla cima della testa
    const rad = 0.47;
    for (const g of [-8, 38, 92, 148, 200, 242]) {
      const a = (g * Math.PI) / 180;
      pts.push([0.5 + Math.cos(a) * rad * 1.02, 0.5 + Math.sin(a) * rad]);
    }
    const hp = hoverPunto();
    pts.push([nx(hp[0]), ny(hp[1])]);

    poly = []; cum = [0];
    const ext = [pts[0], ...pts, pts[pts.length - 1]];
    for (let i = 1; i < ext.length - 2; i++) {
      for (let s = 0; s < 28; s++) {
        catmull(ext[i - 1], ext[i], ext[i + 1], ext[i + 2], s / 28, tmp);
        poly.push([tmp[0], tmp[1]]);
      }
    }
    poly.push(pts[pts.length - 1]);
    for (let i = 1; i < poly.length; i++) {
      cum.push(cum[i - 1] + Math.hypot((poly[i][0] - poly[i - 1][0]) * W, (poly[i][1] - poly[i - 1][1]) * H));
    }
    lung = cum[cum.length - 1];
    durataEntra = clamp(lung / clamp(W * 0.75, 260, 520), 3.2, 7);
    ip = 0;
  }

  /** Poco sopra la cima della testa, dove la farfalla si ferma. */
  function hoverPunto() {
    const p = plush.punto(punti.testa.sopra.x, punti.testa.sopra.y);
    return [p[0] + rect().width * 0.015, p[1] - rect().width * 0.07];
  }

  function suPercorso(d, out) {
    while (ip < cum.length - 2 && cum[ip + 1] < d) ip++;
    const a = poly[ip], b = poly[ip + 1];
    const seg = cum[ip + 1] - cum[ip] || 1;
    const u = clamp((d - cum[ip]) / seg, 0, 1);
    const r = rect();
    out[0] = r.left + lerp(a[0], b[0], u) * r.width;
    out[1] = r.top + lerp(a[1], b[1], u) * r.height;
  }

  // ---- disegno ------------------------------------------------------------
  function disegna() {
    rot = ((((rot + 180) % 360) + 360) % 360) - 180; // l'angolo non cresce all'infinito
    sprite.style.transform = `translate(${(x - 20).toFixed(1)}px,${(y - 20).toFixed(1)}px) rotate(${rot.toFixed(1)}deg)`;
  }
  function ali(freq, ampiezza, dt) {
    flap += dt * freq * 6.2832;
    const aperta = 0.3 + 0.7 * (0.5 + 0.5 * Math.cos(flap) * ampiezza);
    const s = lerp(aperta, 0.16, piega).toFixed(3);
    alaS.style.transform = alaD.style.transform = `scaleX(${s})`;
  }
  function volgi(nx, ny, dt) {
    const vx = nx - x, vy = ny - y;
    if (vx * vx + vy * vy > 0.04) {
      const bersaglio = (Math.atan2(vx, -vy) * 180) / Math.PI;
      rot += dAng(rot, bersaglio) * (1 - Math.exp(-dt * 9));
    }
    x = nx; y = ny;
  }

  // ---- fasi ----------------------------------------------------------------
  function avvia() {
    costruisciPercorso();
    fase = 'entra'; t = 0; tot = 0; piega = 0;
    suPercorso(0, tmp);
    x = tmp[0]; y = tmp[1]; rot = -90;
    sprite.className = 'fc-farfalla';
    sprite.style.display = '';
    layer.appendChild(sprite);
    avviaCiclo();
  }

  function aggiorna(dt) {
    t += dt; tot += dt;
    const r = rect();

    if (fase === 'entra') {
      const u = t / durataEntra;
      suPercorso(eio(u) * lung, tmp);
      // ondeggiare laterale, che si spegne in arrivo
      const k = 1 - smooth(0.85, 1, u);
      const nx = tmp[0] + (Math.sin(tot * 3.3) * 9 + Math.sin(tot * 7.1) * 3) * k;
      const ny = tmp[1] + (Math.cos(tot * 2.7) * 7 + Math.sin(flap * 0.5) * 2) * k;
      volgi(nx, ny, dt);
      ali(11, 1, dt);
      plush.guarda(x, y);
      if (u >= 1) { fase = 'sosta'; t = 0; }
    } else if (fase === 'sosta') {
      const h = hoverPunto();
      const nx = h[0] + Math.sin(tot * 1.7) * 12 + Math.sin(tot * 3.1) * 4;
      const ny = h[1] + Math.cos(tot * 2.3) * 7;
      volgi(lerp(x, nx, 1 - Math.exp(-dt * 6)), lerp(y, ny, 1 - Math.exp(-dt * 6)), dt);
      rot += dAng(rot, 0) * (1 - Math.exp(-dt * 3)); // si raddrizza mentre sosta
      ali(6.5, 0.8, dt);
      plush.guarda(x, y);
      if (t > 2.2) {
        fase = 'parola'; t = 0; p0x = x; p0y = y;
        const pr = parola.getBoundingClientRect();
        durataParola = clamp(Math.hypot(pr.left - x, pr.top - y) / 330, 1.8, 3.6);
      }
    } else if (fase === 'parola') {
      const pr = parola.getBoundingClientRect();
      const lx = pr.left + pr.width * 0.58, ly = pr.top + pr.height * 0.2;
      const u = clamp(t / durataParola, 0, 1), e = eio(u);
      // Bezier cubica: sale, passa sopra e scende sulla parola dall'alto
      const c1x = p0x + (lx - p0x) * 0.25, c1y = Math.min(p0y, ly) - 130;
      const c2x = lx - 20, c2y = ly - 95;
      const v = 1 - e;
      const bx = v * v * v * p0x + 3 * v * v * e * c1x + 3 * v * e * e * c2x + e * e * e * lx;
      const by = v * v * v * p0y + 3 * v * v * e * c1y + 3 * v * e * e * c2y + e * e * e * ly;
      const k = (1 - u) * (1 - u);
      volgi(bx + Math.sin(tot * 4) * 8 * k, by + Math.cos(tot * 3.4) * 6 * k, dt);
      ali(lerp(10, 7, u), 1, dt);
      plush.guarda(x, y);
      if (u >= 1) { fase = 'atterra'; t = 0; }
    } else if (fase === 'atterra') {
      const pr = parola.getBoundingClientRect();
      const lx = pr.left + pr.width * 0.58, ly = pr.top + pr.height * 0.2;
      x = lerp(x, lx, 1 - Math.exp(-dt * 14));
      y = lerp(y, ly, 1 - Math.exp(-dt * 14));
      rot += dAng(rot, 22) * (1 - Math.exp(-dt * 7)); // si mette di lato
      piega = Math.min(1, t / 0.55); // ripiega le ali
      ali(8 * (1 - piega) + 1, 1 - piega, dt);
      if (t > 0.5) plush.guarda(null);
      if (t >= 0.62) posa();
    } else if (fase === 'fugge') {
      fugaV += 560 * dt;
      const v = Math.min(fugaV, 720);
      const lat = Math.sin(tot * 9) * 70; // zigzag di una farfalla spaventata
      const px = -fugaVy, py = fugaVx; // perpendicolare
      volgi(x + (fugaVx * v + px * lat) * dt, y + (fugaVy * v + py * lat) * dt, dt);
      piega = Math.max(0, piega - dt * 5);
      ali(15, 1, dt);
      if (x < -90 || x > window.innerWidth + 90 || y < -90 || y > window.innerHeight + 90 || t > 7) fine();
    }
    disegna();
  }

  function posa() {
    fase = 'posata';
    cancelAnimationFrame(raf); raf = 0;
    sprite.style.transform = '';
    sprite.className = 'fc-farfalla posata';
    sprite.style.cssText = '';
    parola.appendChild(sprite); // da ora si muove con il testo
    onStato?.('landed');
  }

  function fine() {
    fase = 'fine';
    cancelAnimationFrame(raf); raf = 0;
    sprite.style.display = 'none';
    if (tentativi < 2) programma(22000); // una seconda occasione, mai di piu'
  }

  /** Il ritratto e' stato afferrato: la farfalla scappa. */
  function interrompi() {
    if (fase === 'inattiva' || fase === 'fine') {
      if (fase === 'inattiva') programma(9000);
      return;
    }
    if (fase === 'fugge') return;
    plush.guarda(null);
    if (fase === 'posata') {
      // si stacca dalla parola e riprende il volo da dov'e'
      const b = sprite.getBoundingClientRect();
      x = b.left + b.width / 2; y = b.top + b.height / 2;
      rot = 22;
      sprite.className = 'fc-farfalla';
      sprite.style.cssText = '';
      layer.appendChild(sprite);
      disegna();
    }
    // via dal ritratto e verso l'alto
    const r = rect();
    let dx = x - (r.left + r.width / 2), dy = y - (r.top + r.height / 2);
    const m = Math.hypot(dx, dy) || 1;
    dx /= m; dy /= m;
    dy = Math.min(dy, -0.4);
    const mm = Math.hypot(dx, dy);
    fugaVx = dx / mm; fugaVy = dy / mm; fugaV = 180;
    fase = 'fugge'; t = 0;
    avviaCiclo();
  }

  // ---- ciclo ---------------------------------------------------------------
  function ciclo(ora) {
    if (sospesa || fase === 'posata' || fase === 'fine' || fase === 'inattiva') { raf = 0; return; }
    const dt = Math.min(0.05, (ora - ultimo) / 1000) || 0.016;
    ultimo = ora;
    aggiorna(dt);
    if (raf !== -1 && fase !== 'posata' && fase !== 'fine') raf = requestAnimationFrame(ciclo);
  }
  function avviaCiclo() {
    if (raf || sospesa) return;
    ultimo = performance.now();
    raf = requestAnimationFrame(ciclo);
  }

  // fuori dalla vista o a scheda nascosta si ferma, e riprende da dove era
  plush.on('visibile', (v) => {
    sospesa = !v;
    if (!v) { cancelAnimationFrame(raf); raf = 0; }
    else if (fase !== 'inattiva' && fase !== 'fine' && fase !== 'posata') avviaCiclo();
  });

  function programma(ms) {
    clearTimeout(timerStart);
    timerStart = setTimeout(function prova() {
      // parte solo con l'hero in vista e il ritratto a riposo
      if (!plush.visibile || fase === 'fugge') { timerStart = setTimeout(prova, 1500); return; }
      if (fase === 'fine') fase = 'inattiva';
      tentativi++;
      avvia();
    }, ms);
  }
  programma(3500);

  return {
    interrompi,
    destroy() {
      clearTimeout(timerStart);
      cancelAnimationFrame(raf);
      layer.remove();
      sprite.remove();
    },
    get fase() { return fase; },
    /** Avanza la sequenza di `dt` secondi senza aspettare il rAF: per le prove. */
    passo(dt) {
      if (fase === 'inattiva' || fase === 'fine' || fase === 'posata') return fase;
      aggiorna(dt);
      return fase;
    },
    get stato() { return { fase, x: Math.round(x), y: Math.round(y), rot: Math.round(rot) }; },
  };
}
