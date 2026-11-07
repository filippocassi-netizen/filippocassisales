# Ritratto interattivo dell'hero

Il ritratto è la **fotografia reale**: nessun personaggio generato, nessun
ritocco di identità. Tutto quello che si muove (sguardo, palpebre, sopracciglia,
bocca) è una rimappatura dei pixel della foto stessa, fatta nello shader.

## Avvio

```bash
npm install
npm run dev        # http://localhost:4321/  (it) · /es/ · /en/
npm run build      # produzione, in dist/
python scripts/verifica-ritratto.py   # controllo allineamento dei materiali
```

## Architettura

| Controller | File | Cosa fa |
|---|---|---|
| Fisica | `src/scripts/plushie.js` | maglia 128×128, equazione d'onda smorzata, spostamenti **relativi** alla geometria originale, passo fisso 240 Hz |
| Sguardo | `plushie.js` (`aggiornaSguardo`) | il contenuto dell'apertura dell'occhio scorre di pochi pixel, con rampa che lo tiene dentro l'orbita; dopo 3 s senza mouse torna in avanti |
| Battito | `plushie.js` (`aggiornaBlink`) | ogni 2,6–5,8 s; 75 ms chiude, 30 pausa, 150 apre; ogni tanto doppio |
| Espressioni | `plushie.js` + `PlushPortrait.astro` | cinque foto (con e senza orologio) in dissolvenza + parametri continui per lo shader (cipiglio, palpebra, rossore, labbra) |
| Farfalla | `src/scripts/farfalla.js` | macchina a stati `inattiva → entra → sosta → parola → atterra → posata` (+ `fugge`) |
| Pagina | `src/components/PlushPortrait.astro` | markup, accessibilità, tastiera, collegamento fra i controller |

Lo stato di animazione (JS) è separato dal rendering (shader): ogni frame il JS
aggiorna una dozzina di uniform, lo shader fa il resto. Nessuna texture né
oggetto temporaneo viene creato per frame.

## Comportamento

- **Presa**: si afferra solo la faccia; il corpo resta una fotografia. Al
  rilascio la molla smorzata riporta tutto a riposo, e quando il moto si spegne
  lo spostamento viene **azzerato esattamente** (geometria originale, non
  «quasi»).
- **Emozioni**: sorpresa all'inizio della presa, smorfia di dolore oltre la
  soglia di stiramento, stordimento breve al rilascio, **rabbia alla quarta
  presa entro 9 s** (cipiglio + palpebre socchiuse + rossore, poi torna neutro).
- **Farfalla**: entra da destra, gira attorno al disco, sosta sopra la testa
  (gli occhi la seguono), poi vola sulla parola `data-farfalla` del titolo e vi si
  posa di lato con le ali chiuse. Il punto di atterraggio si legge dal
  rettangolo reale della parola (58 % × 20 %), quindi segue scroll e
  ridimensionamenti; da posata diventa figlia della parola. Se si afferra il
  ritratto, scappa; ritenta una volta dopo 22 s.
- **Mobile**: lo scorrimento verticale resta alla pagina (`touch-action: pan-y`).
  Si afferra con pressione lunga (380 ms, con vibrazione breve) o con un
  trascinamento deliberatamente orizzontale.
- **Tastiera**: il ritratto è focalizzabile; Invio/Spazio = battito; Esc =
  ripristino totale (maglia, espressione, sguardo, orologio).
- **Accessibilità**: `role="group"` con etichetta e descrizione, regione
  `aria-live` con gli stati nelle tre lingue.
- **Movimento ridotto / risparmio dati / niente WebGL / foto non caricata**:
  resta la fotografia statica.
- **Pausa**: fuori dal viewport o a scheda nascosta ciclo di disegno,
  timer di battito e farfalla si fermano.

## Inventario dei materiali

Tutti in `public/img/face/`, **1000 × 1000 px**, WebP con alfa, stessa
sagoma (riquadro 109–864 × 50–1000), allineati pixel per pixel.

| File | Uso |
|---|---|
| `smile.webp` | base a riposo (originale) |
| `deadpan.webp` | al passaggio; base per rabbia e canto |
| `shock.webp` | sorpresa |
| `ouch.webp` | dolore |
| `dizzy.webp` | stordimento |
| `*-nowatch.webp` | stesse cinque, dopo il furto dell'orologio |

Regioni (UV 0–1, in `src/data/ritratto.json`, misurate sulla foto):

| Regione | Centro | Semiassi | Uso |
|---|---|---|---|
| Occhio sx / dx | (0,465; 0,237) / (0,560; 0,247) | 0,030 × 0,0125 | sguardo, palpebre |
| Sopracciglia sx / dx | (0,463; 0,214) / (0,566; 0,226) | 0,055 × 0,019 | cipiglio |
| Bocca | (0,506; 0,352) | 0,062 × 0,032 | labbra raccolte |
| Ovale del viso | (0,49; 0,28) | 0,13 × 0,20 | rossore |
| Faccia deformabile | (0,48; 0,245) | 0,21 × 0,26 | regione mobile della maglia |

Le maschere di occhi, palpebre, sopracciglia e bocca **non sono file**: sono
ellissi con bordo sfumato risolte nello shader dai numeri sopra, quindi restano
allineate a qualunque faccia. `scripts/verifica-ritratto.py` le disegna sopra
ogni foto (`scripts/_controllo/`).

Non c'è una segmentazione di iride, sclera e palpebre in layer separati: sulla
foto reale non si estraggono in modo affidabile, e la specifica chiede in quel
caso di usare deformazione localizzata e maschere. La palpebra copre l'occhio
con la pelle sotto di esso, ricolorata.

## Collaudo

Eseguiti sul server di sviluppo:

| Prova | Esito |
|---|---|
| `npm run build` (11 pagine) | ok |
| `verifica-ritratto.py` | 10 facce, stessa dimensione e sagoma (±2 px) |
| Passo di fisica (`__plush.bench()`, 128×128) | ~0,4 ms/passo, ~1,7 ms/frame |
| Battito con palpebra al 100 % | occhi chiusi, volto integro |
| Sequenza farfalla simulata a passi di 1/60 s | tutte le fasi, atterraggio a 104,4 / 284,6 = bersaglio |

**Da provare a mano** (non verificato in questo ambiente, il pannello di anteprima
non esegue `requestAnimationFrame` con continuità):
- aspetto di cipiglio/rabbia a velocità reale;
- sguardo che segue il mouse e ritorno dopo 3 s;
- gesti touch su telefono vero (pressione lunga, trascinamento orizzontale,
  scroll verticale sopra il ritratto);
- screen reader (annunci di stato);
- 60 fps su telefono di fascia bassa.

Strumenti di prova (solo in `npm run dev`): `window.__plush` (`fx({brow,squint,flush,hum,blink})`,
`guarda(x,y)`, `bench()`) e `window.__farfalla` (`passo(dt)`, `stato`).
