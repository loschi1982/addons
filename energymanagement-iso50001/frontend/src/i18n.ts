import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

const resources = {
  de: {
    translation: {
      // Navigation
      'nav.dashboard': 'Dashboard',
      'nav.sites': 'Standorte',
      'nav.meters': 'Zähler',
      'nav.meterMap': 'Zähler-Karte',
      'nav.readings': 'Ablesungen',
      'nav.consumers': 'Verbraucher',
      'nav.energyReview': 'Energiebewertung',
      'nav.schema': 'Energieschema',
      'nav.schemas': 'Schemas',
      'nav.analytics': 'Auswertungen',
      'nav.emissions': 'Emissionen',
      'nav.weather': 'Wetter',
      'nav.climate': 'Raumklima',
      'nav.reports': 'Berichte',
      'nav.iso': 'ISO 50001',
      'nav.users': 'Benutzer',
      'nav.import': 'Import',
      'nav.integrations': 'Integrationen',
      'nav.settings': 'Einstellungen',
      // Allgemein
      'common.save': 'Speichern',
      'common.cancel': 'Abbrechen',
      'common.delete': 'Löschen',
      'common.edit': 'Bearbeiten',
      'common.create': 'Erstellen',
      'common.search': 'Suchen',
      'common.loading': 'Laden...',
      'common.error': 'Fehler',
      'common.success': 'Erfolgreich',
      'common.confirm': 'Bestätigen',
      'common.back': 'Zurück',
      'common.next': 'Weiter',
      'common.yes': 'Ja',
      'common.no': 'Nein',
      // Auth
      'auth.login': 'Anmelden',
      'auth.logout': 'Abmelden',
      'auth.username': 'Benutzername',
      'auth.password': 'Passwort',
    },
  },
  en: {
    translation: {
      'nav.dashboard': 'Dashboard',
      'nav.sites': 'Sites',
      'nav.meters': 'Meters',
      'nav.meterMap': 'Meter Map',
      'nav.readings': 'Readings',
      'nav.consumers': 'Consumers',
      'nav.energyReview': 'Energy Review',
      'nav.schema': 'Energy Schema',
      'nav.schemas': 'Schemas',
      'nav.analytics': 'Analytics',
      'nav.emissions': 'Emissions',
      'nav.weather': 'Weather',
      'nav.climate': 'Climate',
      'nav.reports': 'Reports',
      'nav.iso': 'ISO 50001',
      'nav.users': 'Users',
      'nav.import': 'Import',
      'nav.integrations': 'Integrations',
      'nav.settings': 'Settings',
      'common.save': 'Save',
      'common.cancel': 'Cancel',
      'common.delete': 'Delete',
      'common.edit': 'Edit',
      'common.create': 'Create',
      'common.search': 'Search',
      'common.loading': 'Loading...',
      'common.error': 'Error',
      'common.success': 'Success',
      'common.confirm': 'Confirm',
      'common.back': 'Back',
      'common.next': 'Next',
      'common.yes': 'Yes',
      'common.no': 'No',
      'auth.login': 'Login',
      'auth.logout': 'Logout',
      'auth.username': 'Username',
      'auth.password': 'Password',
    },
  },
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'de',
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
