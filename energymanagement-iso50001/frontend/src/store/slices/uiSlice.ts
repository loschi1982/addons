import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export type ThemeMode = 'light' | 'dark';

const THEME_KEY = 'em_theme';

function readInitialTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {
    /* ignore */
  }
  return 'light';
}

interface UIState {
  sidebarOpen: boolean;
  language: 'de' | 'en';
  theme: ThemeMode;
  notifications: Array<{
    id: string;
    type: 'success' | 'error' | 'warning' | 'info';
    message: string;
  }>;
  backupLocked: boolean;
}

const initialState: UIState = {
  sidebarOpen: true,
  language: 'de',
  theme: readInitialTheme(),
  notifications: [],
  backupLocked: false,
};

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    toggleSidebar(state) {
      state.sidebarOpen = !state.sidebarOpen;
    },
    setLanguage(state, action: PayloadAction<'de' | 'en'>) {
      state.language = action.payload;
    },
    setTheme(state, action: PayloadAction<ThemeMode>) {
      state.theme = action.payload;
    },
    toggleTheme(state) {
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
    },
    addNotification(
      state,
      action: PayloadAction<{ type: 'success' | 'error' | 'warning' | 'info'; message: string }>
    ) {
      state.notifications.push({
        id: Date.now().toString(),
        ...action.payload,
      });
    },
    removeNotification(state, action: PayloadAction<string>) {
      state.notifications = state.notifications.filter((n) => n.id !== action.payload);
    },
    setBackupLocked(state, action: PayloadAction<boolean>) {
      state.backupLocked = action.payload;
    },
  },
});

export const {
  toggleSidebar,
  setLanguage,
  setTheme,
  toggleTheme,
  addNotification,
  removeNotification,
  setBackupLocked,
} = uiSlice.actions;
export default uiSlice.reducer;
