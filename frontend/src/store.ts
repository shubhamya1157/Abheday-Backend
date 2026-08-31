import { configureStore, createSlice } from '@reduxjs/toolkit'
import type { PayloadAction } from '@reduxjs/toolkit'

export type View = 'dashboard' | 'workbench' | 'chats' | 'tasks' | 'documents' | 'models' | 'status' | 'activity' | 'settings'

type UiState = {
  authenticated: boolean
  view: View
  workspace: string
  mobileOpen: boolean
  theme: 'dark' | 'light'
  composer: string
  attachmentIntent: 'none' | 'document' | 'image'
  routingOpen: boolean
  guardrailsOpen: boolean
  traceVisible: boolean
  executionStatus: 'idle' | 'running' | 'completed' | 'blocked'
  toast: string | null
}

const initialState: UiState = {
  authenticated: false,
  view: 'dashboard',
  workspace: 'Industrial Operations Workspace',
  mobileOpen: false,
  theme: 'dark',
  composer: '',
  attachmentIntent: 'none',
  routingOpen: true,
  guardrailsOpen: false,
  traceVisible: false,
  executionStatus: 'idle',
  toast: null,
}

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    signIn: (state) => { state.authenticated = true },
    signOut: (state) => { state.authenticated = false; state.view = 'dashboard'; state.composer = ''; state.attachmentIntent = 'none'; state.traceVisible = false; state.executionStatus = 'idle' },
    setView: (state, action: PayloadAction<View>) => { state.view = action.payload },
    setWorkspace: (state, action: PayloadAction<string>) => { state.workspace = action.payload },
    setMobileOpen: (state, action: PayloadAction<boolean>) => { state.mobileOpen = action.payload },
    toggleTheme: (state) => { state.theme = state.theme === 'dark' ? 'light' : 'dark' },
    setComposer: (state, action: PayloadAction<string>) => { state.composer = action.payload },
    setAttachmentIntent: (state, action: PayloadAction<'none' | 'document' | 'image'>) => { state.attachmentIntent = action.payload },
    setRoutingOpen: (state, action: PayloadAction<boolean>) => { state.routingOpen = action.payload },
    setGuardrailsOpen: (state, action: PayloadAction<boolean>) => { state.guardrailsOpen = action.payload },
    setTraceVisible: (state, action: PayloadAction<boolean>) => { state.traceVisible = action.payload },
    setExecutionStatus: (state, action: PayloadAction<'idle' | 'running' | 'completed' | 'blocked'>) => { state.executionStatus = action.payload },
    showToast: (state, action: PayloadAction<string>) => { state.toast = action.payload },
    clearToast: (state) => { state.toast = null },
  },
})

export const { signIn, signOut, setView, setWorkspace, setMobileOpen, toggleTheme, setComposer, setAttachmentIntent, setRoutingOpen, setGuardrailsOpen, setTraceVisible, setExecutionStatus, showToast, clearToast } = uiSlice.actions
export const store = configureStore({ reducer: { ui: uiSlice.reducer } })
export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
