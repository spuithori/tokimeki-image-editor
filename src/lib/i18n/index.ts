import { addMessages, init, getLocaleFromNavigator } from 'svelte-i18n';

import en from './locales/en.json';
import ja from './locales/ja.json';

addMessages('en', en);
addMessages('ja', ja);

init({
  fallbackLocale: 'en',
  initialLocale: getLocaleFromNavigator(),
});
