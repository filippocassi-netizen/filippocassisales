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
  contatti: { it: '/contatti/', es: '/es/contacto/', en: '/en/contact/' },
} satisfies Record<string, Record<Lang, string>>;

const ETICHETTE: Record<Lang, Record<keyof typeof PAGINE, string>> = {
  it: { home: 'Home', chiSono: 'Chi sono', contatti: 'Contatti' },
  es: { home: 'Inicio', chiSono: 'Sobre mí', contatti: 'Contacto' },
  en: { home: 'Home', chiSono: 'About', contatti: 'Contact' },
};

const ORDINE = ['home', 'chiSono', 'contatti'] as const;

/** Menu di navigazione: stesse tre voci in tutte le lingue. */
export function menu(lang: Lang): { label: string; href: string }[] {
  return ORDINE.map((k) => ({ label: ETICHETTE[lang][k], href: PAGINE[k][lang] }));
}

export const TESTI: Record<Lang, Record<string, string>> = {
  it: {
    ctaPrincipale: 'Lavoriamo insieme',
    ctaSecondaria: 'La mia storia',
    ctaContatto: 'Contattami',
    leggiStoria: 'Leggi tutta la storia',
  },
  es: {
    ctaPrincipale: 'Trabajemos juntos',
    ctaSecondaria: 'Mi historia',
    ctaContatto: 'Escríbeme',
    leggiStoria: 'Leer la historia completa',
  },
  en: {
    ctaPrincipale: "Let's work together",
    ctaSecondaria: 'My story',
    ctaContatto: 'Get in touch',
    leggiStoria: 'Read the full story',
  },
};


/** Ricava la lingua dal percorso: /es/... -> es, /en/... -> en, tutto il resto it. */
export function linguaDaUrl(pathname: string): Lang {
  if (pathname.startsWith('/es/') || pathname === '/es') return 'es';
  if (pathname.startsWith('/en/') || pathname === '/en') return 'en';
  return 'it';
}
