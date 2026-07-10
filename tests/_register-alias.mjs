import { register } from 'node:module';

register(new URL('./_alias-loader.mjs', import.meta.url));
