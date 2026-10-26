import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { hasValidToken } from './api/auth.js'
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
          <Route path="/acs" element={<Dashboard />}>
            <Route index element={<GenieAcs />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
