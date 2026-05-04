import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

interface UIState {
  sidebarOpen: boolean;
  language: 'de' | 'en';
  theme: 'light';
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
  theme: 'light',
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

export const { toggleSidebar, setLanguage, addNotification, removeNotification, setBackupLocked } = uiSlice.actions;
export default uiSlice.reducer;
