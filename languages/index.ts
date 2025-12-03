
import { en } from './en';
import { es } from './es';
import { zh } from './zh';
import { hi } from './hi';
import { ru } from './ru';
import { Translation } from './types';

export type LanguageCode = 'en' | 'es' | 'zh' | 'hi' | 'ru';

export const languages: Record<LanguageCode, { name: string; data: Translation }> = {
  en: { name: "English", data: en },
  es: { name: "Español", data: es },
  zh: { name: "中文", data: zh },
  hi: { name: "हिन्दी", data: hi },
  ru: { name: "Русский", data: ru },
};

export const defaultLanguage: LanguageCode = 'en';
