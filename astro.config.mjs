import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://filippocassisales.com',
  // Le home ES ed EN del vecchio WordPress erano su uno slug di pagina.
  // GitHub Pages non legge .htaccess: Astro genera una pagina di redirect.
  redirects: {
    '/es/la-venta-es-una-historia-de-confianza': '/es/',
    '/en/selling-is-a-story-of-trust': '/en/',
  },
});
