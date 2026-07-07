import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'

import de from './de.json'
import en from './en.json'
import lt from './lt.json'
import pl from './pl.json'

// EN/PL/LT/DE skeleton (PROJECT_PLAN §4 i18n); lint enforcement arrives with E08-3.
void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      pl: { translation: pl },
      lt: { translation: lt },
      de: { translation: de },
    },
    fallbackLng: 'en',
    interpolation: { escapeValue: false }, // react escapes
  })

export default i18n
