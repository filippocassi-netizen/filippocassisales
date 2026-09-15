export type Lang = 'it' | 'es' | 'en';

export const LINGUA_PREDEFINITA: Lang = 'it';

export const LINGUE: { code: Lang; label: string; flag: string }[] = [
  { code: 'it', label: 'Italiano', flag: '/img/flags/it.png' },
  { code: 'es', label: 'Español', flag: '/img/flags/es.png' },
  { code: 'en', label: 'English', flag: '/img/flags/en.png' },
];

export const OG_LOCALE: Record<Lang, string> = {
  it: 'it_IT',
  es: 'es_ES',
  en: 'en_US',
};

/**
 * Le pagine del sito, con l'URL in ogni lingua.
 * Ogni voce qui dentro è anche la mappa `translations` da passare al layout,
 * quindi hreflang e selettore di lingua restano automaticamente allineati.
 * Le tre lingue hanno esattamente le stesse pagine: se ne aggiungi una, va
 * aggiunta in tutte e tre.
 */
export const PAGINE = {
  home: { it: '/', es: '/es/', en: '/en/' },
  chiSono: { it: '/chi-sono/', es: '/es/sobre-mi/', en: '/en/about/' },
  blog: { it: '/blog/', es: '/es/articulos/', en: '/en/articles/' },
  contatti: { it: '/contatti/', es: '/es/contacto/', en: '/en/contact/' },
} satisfies Record<string, Record<Lang, string>>;

export const INDICE_BLOG = PAGINE.blog;

const ETICHETTE: Record<Lang, Record<keyof typeof PAGINE, string>> = {
  it: { home: 'Home', chiSono: 'Chi sono', blog: 'Blog', contatti: 'Contatti' },
  es: { home: 'Inicio', chiSono: 'Sobre mí', blog: 'Artículos', contatti: 'Contacto' },
  en: { home: 'Home', chiSono: 'About', blog: 'Articles', contatti: 'Contact' },
};

const ORDINE = ['home', 'chiSono', 'blog', 'contatti'] as const;

/** Menu di navigazione: stesse quattro voci in tutte le lingue. */
export function menu(lang: Lang): { label: string; href: string }[] {
  return ORDINE.map((k) => ({ label: ETICHETTE[lang][k], href: PAGINE[k][lang] }));
}

export const TESTI: Record<Lang, Record<string, string>> = {
  it: {
    tornaAlBlog: '← Tutti gli articoli',
    titoloBlog: 'Blog',
    sottotitoloBlog: 'Appunti su vendita, ascolto e strumenti che mi costruisco.',
    leggi: 'Leggi',
    ctaPrincipale: 'Lavoriamo insieme',
    ctaSecondaria: 'La mia storia',
    ctaContatto: 'Contattami',
    leggiStoria: 'Leggi tutta la storia',
  },
  es: {
    tornaAlBlog: '← Todos los artículos',
    titoloBlog: 'Artículos',
    sottotitoloBlog: 'Notas sobre venta, escucha y herramientas que me construyo.',
    leggi: 'Leer',
    ctaPrincipale: 'Trabajemos juntos',
    ctaSecondaria: 'Mi historia',
    ctaContatto: 'Escríbeme',
    leggiStoria: 'Leer la historia completa',
  },
  en: {
    tornaAlBlog: '← All articles',
    titoloBlog: 'Articles',
    sottotitoloBlog: 'Notes on selling, listening, and the tools I build for myself.',
    leggi: 'Read',
    ctaPrincipale: "Let's work together",
    ctaSecondaria: 'My story',
    ctaContatto: 'Get in touch',
    leggiStoria: 'Read the full story',
  },
};

const LOCALE_DATA: Record<Lang, string> = { it: 'it-IT', es: 'es-ES', en: 'en-GB' };

export function formattaData(iso: string, lang: Lang): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(LOCALE_DATA[lang], {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** Ricava la lingua dal percorso: /es/... -> es, /en/... -> en, tutto il resto it. */
export function linguaDaUrl(pathname: string): Lang {
  if (pathname.startsWith('/es/') || pathname === '/es') return 'es';
  if (pathname.startsWith('/en/') || pathname === '/en') return 'en';
  return 'it';
}
