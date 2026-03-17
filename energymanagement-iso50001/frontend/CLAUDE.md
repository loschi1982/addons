# Frontend – CLAUDE.md

## Tech-Stack
React 18 + TypeScript (strict) + Redux Toolkit + Tailwind CSS + Vite

## Design-System
- Primärfarbe: `#1B5E7B` (Petrol) → `primary-500`
- Font: Inter (Google Fonts)
- Energietyp-Farben: siehe `tailwind.config.js` → `energy.*`
- CSS-Klassen: `card`, `btn-primary`, `btn-secondary`, `input`, `label`, `page-title`
- Charts: Recharts
- Drag & Drop: dnd-kit

## Ordnerstruktur
- `components/` – Wiederverwendbare UI-Komponenten, nach Modul gruppiert
- `pages/` – Route-Seiten (eine pro Hauptnavigation)
- `store/slices/` – Redux Toolkit Slices
- `hooks/` – Custom Hooks (`useAppDispatch`, `useAppSelector`)
- `utils/` – API-Client, Formatierung
- `types/` – Gemeinsame TypeScript-Typen

## Konventionen
- Alle Texte auf Deutsch (UI-Labels, Fehlermeldungen)
- API-Calls über `apiClient` (utils/api.ts) mit Auto-Auth
- Komponenten als Function Components mit TypeScript Props
- State: Redux Toolkit für globalen State, React State für lokalen

## Befehle
```bash
npm run dev        # Vite Dev-Server (Port 3000)
npm run build      # Production-Build nach dist/
npm run type-check # TypeScript-Prüfung ohne Build
```
