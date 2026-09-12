# filippocassisales — sito in Astro

Porting in **Astro 7 + TypeScript** del sito WordPress su
`filippocassisales.com`. Output: HTML statico, nessun file JavaScript
(lo script del menu mobile è inline, ~200 byte).

Pagine portate (versione italiana): **Home**, **Chi sono**, **Contatti**.

## Comandi

| Comando           | Cosa fa                                                    |
| ----------------- | ---------------------------------------------------------- |
| `npm run dev`     | Server locale su http://localhost:4321                     |
| `npm run build`   | Genera il sito statico in `dist/`                          |
| `npm run preview` | Serve `dist/` in locale, per controllare prima di caricare |
| `npm run check`   | Controlla errori di tipo e di sintassi                     |

### Nota sul server locale (Astro 7)

Da Astro 7 `astro dev` gira come **daemon in background**: il comando torna
subito al prompt e il server resta su. Per gestirlo:

```
npx astro dev status
npx astro dev logs
npx astro dev stop
```

## Struttura

```
filippocassisales/
├── astro.config.mjs
├── public/
│   ├── favicon.svg
│   └── img/                ← immagini scaricate dal sito WordPress
│       ├── logo-filippo-cassi-firma.png
│       ├── filippo-cassi-*.jpg
│       └── flags/          ← bandiere del selettore lingua (it/es/en)
└── src/
    ├── components/
    │   ├── Header.astro    ← logo, menu, selettore lingua, menu mobile
    │   └── Footer.astro
    ├── layouts/
    │   └── BaseLayout.astro  ← <head>, font Google, meta e SEO
    ├── pages/
    │   ├── index.astro       ← Home
    │   ├── chi-sono.astro
    │   └── contatti.astro
    └── styles/
        └── global.css        ← il design system (classi `fc-`)
```

## Il design system

Ricostruito a partire dal CSS custom del sito WordPress (~18.000 caratteri
scritti a mano nel Customizer e nelle pagine). Le variabili stanno in cima a
`global.css`:

- navy `#0b1526` · `#14263f` · `#1b3a5c`
- oro `#c9a45c`, chiaro `#dbb872`, scuro `#b08d45`, pallido `#eedcab`
- font **Fraunces** (titoli) + **Inter** (testo), da Google Fonts

Sono replicati anche i dettagli: onde SVG tra le sezioni, shimmer sui numeri,
lucido sui bottoni, aloni radiali, animazioni d'ingresso e scroll-driven,
e il rispetto di `prefers-reduced-motion`.

## Cosa NON è stato portato

- **Versioni spagnola e inglese.** Il sito WordPress ha 3 lingue via Polylang
  (`/es/`, `/en/`). Qui c'è solo l'italiano. Nel menu i link ES/EN puntano
  ancora al WordPress live.
- **Il blog** (IT/ES/EN, gestito in WordPress con Rank Math). Nel menu la voce
  "Blog" punta al WordPress live.

## Scostamenti voluti rispetto all'originale

Due punti dove non ho copiato l'originale, entrambi reversibili:

1. **Testo base a 16px** invece di 14.6px. Quel valore sul sito live non è una
   scelta: è un default del tema Astra, e sotto i 15px il testo si legge male.
   Per tornare identico: in `global.css`, `body { font-size: 14.592px }`.
2. **Meta description della home** riscritta come frase compiuta. Quella live
   è generata da Rank Math e si taglia a metà ("...una cosa che non").

## Caricare su Hostinger

1. `npm run build`
2. Caricare **il contenuto** di `dist/` (non la cartella) in `public_html`.

Non serve `.htaccess`: Astro genera file HTML reali in cartelle
(`/chi-sono/index.html`), che il server serve direttamente.

**Attenzione:** oggi in `public_html` gira WordPress con il blog IT/ES/EN.
Caricare qui questo sito lo sostituirebbe, e con esso blog e versioni ES/EN.
Va deciso prima se questo sito va su un sottodominio di prova, in una
sottocartella, o se sostituisce l'installazione — e in quel caso blog e
multilingua vanno portati prima.
