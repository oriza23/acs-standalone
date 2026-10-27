import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { hasValidToken } from './api/auth.js'
import AccountSettings from './AccountSettings.jsx'
import AppShell from './AppShell.jsx'
import Dashboard from './Dashboard.jsx'
import GenieAcs from './GenieAcs.jsx'
import Login from './Login.jsx'

// Halaman yang butuh login: tanpa token yang valid, paksa kembali ke halaman Login.
function ProtectedRoute() {
  return hasValidToken() ? <Outlet /> : <Navigate to="/" replace />
}

// Root: pengguna yang sudah login langsung masuk ke GenieACS.
function Home() {
  return hasValidToken() ? <Navigate to="/acs" replace /> : <Login />
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<AppShell />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/acs" element={<GenieAcs />} />
            <Route path="/akun" element={<AccountSettings />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
