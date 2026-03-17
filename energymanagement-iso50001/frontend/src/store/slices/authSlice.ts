import { createSlice, createAsyncThunk, type PayloadAction } from '@reduxjs/toolkit';
import { apiClient } from '@/utils/api';

interface UserProfile {
  id: string;
  username: string;
  email: string;
  displayName: string | null;
  language: string;
  roleName: string;
  permissions: string[];
  mustChangePassword?: boolean;
}

interface AuthState {
  isAuthenticated: boolean;
  user: UserProfile | null;
  accessToken: string | null;
  refreshToken: string | null;
  loading: boolean;
  error: string | null;
  setupRequired: boolean | null;
}

const initialState: AuthState = {
  isAuthenticated: !!localStorage.getItem('access_token'),
  user: null,
  accessToken: localStorage.getItem('access_token'),
  refreshToken: localStorage.getItem('refresh_token'),
  loading: false,
  error: null,
  setupRequired: null,
};

export const login = createAsyncThunk(
  'auth/login',
  async (credentials: { username: string; password: string }, { rejectWithValue }) => {
    try {
      const response = await apiClient.post('/api/v1/auth/login', credentials);
      return response.data;
    } catch (error: unknown) {
      const err = error as { response?: { data?: { detail?: string } } };
      return rejectWithValue(err.response?.data?.detail || 'Login fehlgeschlagen');
    }
  }
);

export const fetchProfile = createAsyncThunk(
  'auth/fetchProfile',
  async (_, { rejectWithValue }) => {
    try {
      const response = await apiClient.get('/api/v1/auth/me');
      return response.data;
    } catch (error: unknown) {
      const err = error as { response?: { data?: { detail?: string } } };
      return rejectWithValue(err.response?.data?.detail || 'Profil konnte nicht geladen werden');
    }
  }
);

export const checkSetupStatus = createAsyncThunk(
  'auth/checkSetup',
  async () => {
    const response = await apiClient.get('/api/v1/auth/setup/status');
    return response.data.setup_required;
  }
);

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    logout(state) {
      state.isAuthenticated = false;
      state.user = null;
      state.accessToken = null;
      state.refreshToken = null;
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
    },
    setTokens(state, action: PayloadAction<{ accessToken: string; refreshToken: string }>) {
      state.isAuthenticated = true;
      state.accessToken = action.payload.accessToken;
      state.refreshToken = action.payload.refreshToken;
      localStorage.setItem('access_token', action.payload.accessToken);
      localStorage.setItem('refresh_token', action.payload.refreshToken);
    },
    clearError(state) {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      // Login
      .addCase(login.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(login.fulfilled, (state, action) => {
        state.loading = false;
        state.isAuthenticated = true;
        state.accessToken = action.payload.access_token;
        state.refreshToken = action.payload.refresh_token;
        localStorage.setItem('access_token', action.payload.access_token);
        localStorage.setItem('refresh_token', action.payload.refresh_token);

        // must_change_password aus Login-Response merken
        if (action.payload.must_change_password) {
          state.user = { mustChangePassword: true } as UserProfile;
        }
      })
      .addCase(login.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload as string;
      })
      // Profil
      .addCase(fetchProfile.fulfilled, (state, action) => {
        state.user = {
          id: action.payload.id,
          username: action.payload.username,
          email: action.payload.email,
          displayName: action.payload.display_name,
          language: action.payload.language || 'de',
          roleName: action.payload.role_name,
          permissions: action.payload.permissions,
        };
      })
      .addCase(fetchProfile.rejected, (state) => {
        // Token ungültig → ausloggen
        state.isAuthenticated = false;
        state.user = null;
        state.accessToken = null;
        state.refreshToken = null;
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
      })
      // Setup-Status
      .addCase(checkSetupStatus.fulfilled, (state, action) => {
        state.setupRequired = action.payload;
      });
  },
});

export const { logout, setTokens, clearError } = authSlice.actions;
export default authSlice.reducer;
