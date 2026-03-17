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
}

const initialState: UIState = {
  sidebarOpen: true,
  language: 'de',
  theme: 'light',
  notifications: [],
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
  },
});

export const { toggleSidebar, setLanguage, addNotification, removeNotification } = uiSlice.actions;
export default uiSlice.reducer;
