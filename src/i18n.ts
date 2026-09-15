export type Lang = 'it' | 'es' | 'en';

export const LINGUA_PREDEFINITA: Lang = 'it';

export const LINGUE: { code: Lang; label: string; flag: string; home: string }[] = [
  { code: 'it', label: 'Italiano', flag: '/img/flags/it.png', home: '/' },
  { code: 'es', label: 'Español', flag: '/img/flags/es.png', home: '/es/' },
  { code: 'en', label: 'English', flag: '/img/flags/en.png', home: '/en/' },
];

/** Valore di og:locale e dell'attributo lang. */
export const OG_LOCALE: Record<Lang, string> = {
  it: 'it_IT',
  es: 'es_ES',
  en: 'en_US',
};

/** Indice del blog per lingua. Gli URL replicano quelli del vecchio sito WordPress. */
export const INDICE_BLOG: Record<Lang, string> = {
  it: '/blog/',
  es: '/es/articulos/',
  en: '/en/articles/',
};

/**
 * Voci di menu per lingua.
 * ES ed EN hanno solo home e articoli: sono le uniche sezioni che esistevano
 * anche sul sito precedente. Chi sono e Contatti restano solo in italiano.
 */
export const MENU: Record<Lang, { label: string; href: string }[]> = {
  it: [
    { label: 'Home', href: '/' },
    { label: 'Chi sono', href: '/chi-sono/' },
    { label: 'Blog', href: '/blog/' },
    { label: 'Contatti', href: '/contatti/' },
  ],
  es: [
    { label: 'Inicio', href: '/es/' },
    { label: 'Artículos', href: '/es/articulos/' },
  ],
  en: [
    { label: 'Home', href: '/en/' },
    { label: 'Articles', href: '/en/articles/' },
  ],
};

export const TESTI: Record<Lang, Record<string, string>> = {
  it: {
    tornaAlBlog: '← Tutti gli articoli',
    titoloBlog: 'Blog',
    sottotitoloBlog: 'Appunti su vendita, ascolto e strumenti che mi costruisco.',
    leggi: 'Leggi',
    pubblicatoIl: 'Pubblicato il',
    altreLingue: 'Leggi in',
    non_trovato: 'Pagina non trovata',
    non_trovato_testo: 'La pagina che cercavi non esiste o è stata spostata.',
    tornaHome: 'Torna alla home',
  },
  es: {
    tornaAlBlog: '← Todos los artículos',
    titoloBlog: 'Artículos',
    sottotitoloBlog: 'Notas sobre venta, escucha y herramientas que me construyo.',
    leggi: 'Leer',
    pubblicatoIl: 'Publicado el',
    altreLingue: 'Leer en',
    non_trovato: 'Página no encontrada',
    non_trovato_testo: 'La página que buscabas no existe o se ha movido.',
    tornaHome: 'Volver al inicio',
  },
  en: {
    tornaAlBlog: '← All articles',
    titoloBlog: 'Articles',
    sottotitoloBlog: 'Notes on selling, listening, and the tools I build for myself.',
    leggi: 'Read',
    pubblicatoIl: 'Published on',
    altreLingue: 'Read in',
    non_trovato: 'Page not found',
    non_trovato_testo: 'The page you were looking for does not exist or has moved.',
    tornaHome: 'Back to home',
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
