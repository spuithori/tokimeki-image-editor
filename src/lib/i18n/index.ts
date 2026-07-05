import { addLocales, getLocale, setLocale } from 'tokimeki-i18n';

import en from './locales/en.json';
import ja from './locales/ja.json';

addLocales({ en: [en], ja: [ja] });

if (!getLocale()) {
  setLocale(typeof navigator !== 'undefined' ? navigator.language : 'en');
}
