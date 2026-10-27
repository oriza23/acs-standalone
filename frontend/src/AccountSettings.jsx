import { useCallback, useEffect, useRef, useState } from 'react'
import { Lock, User } from 'lucide-react'
import Swal from 'sweetalert2'
import api from './api/axios.js'
import { getUserId, getUsername, setUsername } from './api/auth.js'

const fieldClass = 'flex h-12 items-center gap-2 rounded-xl border border-gray-300 bg-gray-50 px-3 text-gray-500 transition-colors duration-300 focus-within:border-cyan-600 focus-within:bg-white focus-within:ring-4 focus-within:ring-cyan-600/15 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-300 dark:focus-within:bg-gray-900'
const inputClass = 'h-full w-full border-0 bg-transparent text-sm font-medium text-gray-900 outline-none dark:text-gray-100'
const buttonClass = 'h-12 cursor-pointer rounded-xl border-0 bg-linear-to-b from-cyan-700 to-cyan-900 text-[15px] font-bold text-white shadow-lg shadow-cyan-900/20 transition-colors duration-300 hover:from-cyan-600 disabled:cursor-wait disabled:opacity-70'

function errorMessage(error, fallback) {
  return error.response?.data?.message || fallback
}

function Notice({ tone, children }) {
  const className = tone === 'ok'
    ? 'rounded-xl bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
    : 'rounded-xl bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800 dark:bg-rose-950 dark:text-rose-200'
  return <p className={className} role={tone === 'ok' ? 'status' : 'alert'}>{children}</p>
}

function TextField({ label, name, type = 'text', autoComplete, value, onChange, placeholder, required = true, disabled = false }) {
  return (
    <label className={`grid gap-1.5 text-sm font-semibold text-gray-600 dark:text-gray-300 ${disabled ? 'opacity-60' : ''}`}>
      <span>{label}</span>
      <div className={fieldClass}>
        {type === 'password' ? <Lock size={18} aria-hidden="true" /> : <User size={18} aria-hidden="true" />}
        <input
          className={inputClass}
          type={type}
          name={name}
          autoComplete={autoComplete}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          required={required}
          disabled={disabled}
        />
      </div>
    </label>
  )
}

function isCurrentUser(rowUsername, currentUsername) {
  return rowUsername?.toLowerCase() === currentUsername?.toLowerCase()
}

function AccountSettings() {
  const [username, setCurrentUsername] = useState(getUsername)
  const [admins, setAdmins] = useState([])
  const [listState, setListState] = useState({ loading: true, error: '' })
  const [deletingId, setDeletingId] = useState(null)
  const [editForm, setEditForm] = useState(null)
  const [newAdmin, setNewAdmin] = useState({ username: '', password: '' })
  const [passwordForm, setPasswordForm] = useState({ old_password: '', new_password: '', confirm_password: '' })
  const [createState, setCreateState] = useState({ loading: false, error: '', ok: '' })
  const [passwordState, setPasswordState] = useState({ loading: false, error: '', ok: '' })
  const [isUpdating, setIsUpdating] = useState(false)
  const [alertStatus, setAlertStatus] = useState(null)
  const [updateError, setUpdateError] = useState('')
  const updateTimer = useRef(null)
  const successTimer = useRef(null)
  const storedUserId = getUserId()
  const currentUserId = storedUserId ?? admins.find((row) => isCurrentUser(row.username, username))?.id ?? null

  function isOwnAccount(adminId) {
    return currentUserId != null && Number(adminId) === Number(currentUserId)
  }

  const loadAdmins = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setListState((current) => ({ ...current, loading: true, error: '' }))
    }
    try {
      const response = await api.get('/api/admin/list')
      const rows = Array.isArray(response.data) ? response.data : []
      setAdmins(rows.map((row) => ({ id: row.id, username: row.username })))
      setListState({ loading: false, error: '' })
    } catch (error) {
      setListState({ loading: false, error: errorMessage(error, 'Gagal memuat daftar admin') })
    }
  }, [])

  useEffect(() => {
    loadAdmins()
    return () => {
      if (updateTimer.current) {
        clearInterval(updateTimer.current)
      }
      if (successTimer.current) {
        clearTimeout(successTimer.current)
      }
    }
  }, [loadAdmins])

  async function handleCreate(event) {
    event.preventDefault()
    setCreateState({ loading: true, error: '', ok: '' })
    try {
      const response = await api.post('/api/admins', {
        username: newAdmin.username.trim(),
        password: newAdmin.password,
      })
      setNewAdmin({ username: '', password: '' })
      setCreateState({ loading: false, error: '', ok: response.data?.message || 'Admin berhasil disimpan' })
      await loadAdmins({ silent: true })
    } catch (error) {
      setCreateState({ loading: false, error: errorMessage(error, 'Gagal menambah admin'), ok: '' })
    }
  }

  async function handlePassword(event) {
    event.preventDefault()
    if (passwordForm.new_password !== passwordForm.confirm_password) {
      setPasswordState({ loading: false, error: 'Konfirmasi password tidak sama', ok: '' })
      return
    }
    setPasswordState({ loading: true, error: '', ok: '' })
    try {
      const response = await api.put('/api/admins/password', passwordForm)
      setPasswordForm({ old_password: '', new_password: '', confirm_password: '' })
      setPasswordState({ loading: false, error: '', ok: response.data?.message || 'Password berhasil diubah' })
    } catch (error) {
      setPasswordState({ loading: false, error: errorMessage(error, 'Gagal mengubah password'), ok: '' })
    }
  }

  const isSuperadmin = Number(currentUserId) === 1

  function canEditAccount(admin) {
    return isSuperadmin || isOwnAccount(admin.id) || (currentUserId == null && isCurrentUser(admin.username, username))
  }

  function canSetPassword(adminId) {
    return isSuperadmin || isOwnAccount(adminId)
  }

  function openEdit(admin) {
    if (!canEditAccount(admin)) {
      return
    }
    setEditForm({
      id: admin.id,
      username: admin.username,
      password: '',
      loading: false,
      error: '',
    })
  }

  async function handleEdit(event) {
    event.preventDefault()
    if (!editForm || !canEditAccount({ id: editForm.id, username: editForm.username })) {
      return
    }
    setEditForm((current) => ({ ...current, loading: true, error: '' }))
    try {
      const editingSelf = isOwnAccount(editForm.id)
      const response = await api.put(`/api/admin/edit/${editForm.id}`, {
        username: editForm.username.trim(),
        password: canSetPassword(editForm.id) ? editForm.password : '',
      })
      if (editingSelf) {
        const nextName = response.data?.username || editForm.username.trim()
        setUsername(nextName)
        setCurrentUsername(nextName)
      }
      setEditForm(null)
      await loadAdmins({ silent: true })
    } catch (error) {
      setEditForm((current) => ({
        ...current,
        loading: false,
        error: errorMessage(error, 'Gagal mengubah admin'),
      }))
    }
  }

  async function handleDelete(admin) {
    if (Number(admin.id) === 1 || isOwnAccount(admin.id) || isCurrentUser(admin.username, username)) {
      return
    }
    const result = await Swal.fire({
      text: '⚠️ Apakah Anda yakin ingin menghapus admin ini? Tindakan ini tidak dapat dibatalkan.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Setuju',
      cancelButtonText: 'Batal',
      confirmButtonColor: '#e11d48',
    })
    if (!result.isConfirmed) {
      return
    }
    setDeletingId(admin.id)
    setListState((current) => ({ ...current, error: '' }))
    try {
      await api.delete(`/api/admin/${admin.id}`)
      setAdmins((current) => current.filter((row) => row.id !== admin.id))
      await loadAdmins({ silent: true })
    } catch (error) {
      setListState({ loading: false, error: errorMessage(error, 'Gagal menghapus admin') })
      await loadAdmins({ silent: true })
    } finally {
      setDeletingId(null)
    }
  }

  async function handleSystemUpdate() {
    const result = await Swal.fire({
      title: 'Proses ini akan mengunduh pembaruan dari GitHub dan me-restart server. Web akan tidak dapat diakses selama kurang lebih 30 detik. Lanjutkan?',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Lanjutkan',
      cancelButtonText: 'Batal',
    })
    if (!result.isConfirmed) {
      return
    }

    setIsUpdating(true)
    setAlertStatus('loading')
    setUpdateError('')
    let previousBoot = null
    try {
      const health = await api.get('/api/health', { timeout: 4000 })
      previousBoot = health.data?.startedAt ?? null
    } catch {
      previousBoot = null
    }

    let sawOutage = previousBoot == null
    try {
      await api.post('/api/admin/system-update')
    } catch (error) {
      if (error.response) {
        setIsUpdating(false)
        setAlertStatus('error')
        setUpdateError(errorMessage(error, 'Gagal memulai pembaruan'))
        return
      }
      sawOutage = true
    }

    let polls = 0
    let polling = false
    updateTimer.current = setInterval(async () => {
      if (polling) {
        return
      }
      polling = true
      polls += 1
      try {
        const ping = await api.get('/api/health', { timeout: 4000 })
        const boot = ping.data?.startedAt
        const restarted = previousBoot != null
          ? Boolean(boot) && boot !== previousBoot
          : sawOutage && Boolean(boot)
        if (restarted) {
          clearInterval(updateTimer.current)
          setIsUpdating(false)
          setAlertStatus('success')
          successTimer.current = setTimeout(() => {
            setAlertStatus(null)
            window.location.reload()
          }, 4000)
          return
        }
      } catch {
        sawOutage = true
      } finally {
        polling = false
      }
      if (polls >= 200) {
        clearInterval(updateTimer.current)
        setIsUpdating(false)
        setAlertStatus('error')
        setUpdateError('Pembaruan belum selesai. Periksa server, lalu muat ulang halaman.')
      }
    }, 3000)
  }

  return (
    <>
      <header>
        <p className="m-0 mb-1.5 text-[13px] font-bold tracking-[0.12em] text-cyan-700 uppercase dark:text-cyan-300">
          Akun
        </p>
        <h1 className="m-0 text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-100">Manajemen Akun Admin</h1>
        {username && (
          <p className="mt-2 mb-0 text-sm text-gray-500 dark:text-gray-400">Sedang masuk sebagai {username}</p>
        )}
      </header>

      <div className="mt-7 grid gap-6 xl:grid-cols-2">
        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <h2 className="m-0 text-lg font-bold text-gray-900 dark:text-gray-100">Tambah Admin</h2>
          <p className="mt-1 mb-0 text-sm text-gray-500 dark:text-gray-400">Username baru dan password minimal 8 karakter.</p>
          <form className="mt-5 grid gap-4" onSubmit={handleCreate}>
            {createState.error && <Notice>{createState.error}</Notice>}
            {createState.ok && <Notice tone="ok">{createState.ok}</Notice>}
            <TextField
              label="Username"
              name="new-username"
              autoComplete="off"
              placeholder="Username admin baru"
              value={newAdmin.username}
              onChange={(event) => setNewAdmin((current) => ({ ...current, username: event.target.value }))}
            />
            <TextField
              label="Password"
              name="new-password"
              type="password"
              autoComplete="new-password"
              placeholder="Password admin baru"
              value={newAdmin.password}
              onChange={(event) => setNewAdmin((current) => ({ ...current, password: event.target.value }))}
            />
            <button className={buttonClass} type="submit" disabled={createState.loading}>
              {createState.loading ? 'Menyimpan...' : 'Tambah Admin'}
            </button>
          </form>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <h2 className="m-0 text-lg font-bold text-gray-900 dark:text-gray-100">Ganti Password</h2>
          <p className="mt-1 mb-0 text-sm text-gray-500 dark:text-gray-400">Password lama dicek dulu sebelum password baru disimpan.</p>
          <form className="mt-5 grid gap-4" onSubmit={handlePassword}>
            {passwordState.error && <Notice>{passwordState.error}</Notice>}
            {passwordState.ok && <Notice tone="ok">{passwordState.ok}</Notice>}
            <TextField
              label="Password lama"
              name="old-password"
              type="password"
              autoComplete="current-password"
              placeholder="Password saat ini"
              value={passwordForm.old_password}
              onChange={(event) => setPasswordForm((current) => ({ ...current, old_password: event.target.value }))}
            />
            <TextField
              label="Password baru"
              name="new-password-change"
              type="password"
              autoComplete="new-password"
              placeholder="Minimal 8 karakter"
              value={passwordForm.new_password}
              onChange={(event) => setPasswordForm((current) => ({ ...current, new_password: event.target.value }))}
            />
            <TextField
              label="Konfirmasi password baru"
              name="confirm-password"
              type="password"
              autoComplete="new-password"
              placeholder="Ulangi password baru"
              value={passwordForm.confirm_password}
              onChange={(event) => setPasswordForm((current) => ({ ...current, confirm_password: event.target.value }))}
            />
            <button className={buttonClass} type="submit" disabled={passwordState.loading}>
              {passwordState.loading ? 'Menyimpan...' : 'Simpan Password'}
            </button>
          </form>
        </section>
      </div>

      <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <h2 className="m-0 text-lg font-bold text-gray-900 dark:text-gray-100">Daftar Admin</h2>
        <p className="mt-1 mb-0 text-sm text-gray-500 dark:text-gray-400">Hanya ID dan username. Password tidak ditampilkan.</p>
        {listState.error && <div className="mt-4"><Notice>{listState.error}</Notice></div>}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-xs tracking-wide text-gray-500 uppercase dark:border-gray-700 dark:text-gray-400">
                <th className="px-3 py-3 font-bold">ID</th>
                <th className="px-3 py-3 font-bold">Username</th>
                <th className="px-3 py-3 font-bold">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {listState.loading && (
                <tr>
                  <td className="px-3 py-4 text-gray-500 dark:text-gray-400" colSpan={3}>Memuat daftar admin...</td>
                </tr>
              )}
              {!listState.loading && !listState.error && admins.length === 0 && (
                <tr>
                  <td className="px-3 py-4 text-gray-500 dark:text-gray-400" colSpan={3}>Belum ada admin.</td>
                </tr>
              )}
              {!listState.loading && admins.map((admin) => {
                const superadmin = Number(admin.id) === 1
                const selfById = isOwnAccount(admin.id)
                const selfByName = isCurrentUser(admin.username, username)
                const self = currentUserId != null ? selfById : selfByName
                const allowEdit = canEditAccount(admin)
                return (
                  <tr key={admin.id} className="border-b border-gray-100 dark:border-gray-700">
                    <td className="px-3 py-3 font-semibold text-gray-900 dark:text-gray-100">{admin.id}</td>
                    <td className="px-3 py-3 text-gray-800 dark:text-gray-200">
                      <span className="inline-flex items-center gap-2">
                        {admin.username}
                        {self && (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                            (Anda)
                          </span>
                        )}
                        {superadmin && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold tracking-wide text-amber-800 uppercase dark:bg-amber-950 dark:text-amber-200">
                            Superadmin
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="h-9 cursor-pointer rounded-lg border-0 bg-cyan-700 px-3 text-sm font-bold text-white hover:bg-cyan-800 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600 dark:disabled:bg-gray-700 dark:disabled:text-gray-400"
                          onClick={() => openEdit(admin)}
                          disabled={!allowEdit}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="h-9 cursor-pointer rounded-lg border-0 bg-rose-600 px-3 text-sm font-bold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600 dark:disabled:bg-gray-700 dark:disabled:text-gray-400"
                          onClick={() => handleDelete(admin)}
                          disabled={superadmin || selfById || selfByName || deletingId === admin.id}
                        >
                          {superadmin ? 'Superadmin' : self ? 'Akun ini' : deletingId === admin.id ? 'Menghapus...' : 'Hapus'}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-6 rounded-2xl border border-rose-300 bg-rose-50 p-6 shadow-sm dark:border-rose-900 dark:bg-rose-950">
        <h2 className="m-0 text-lg font-bold text-rose-800 dark:text-rose-200">Pembaruan Sistem</h2>
        <p className="mt-1 mb-0 text-sm text-rose-700 dark:text-rose-300">
          Mengunduh kode terbaru dari GitHub, lalu me-restart backend dan frontend. Halaman tidak bisa dipakai selama proses ini.
        </p>
        <button
          type="button"
          className="mt-4 h-12 cursor-pointer rounded-xl border-2 border-rose-600 bg-transparent px-4 text-[15px] font-bold text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-70 dark:text-rose-200 dark:hover:bg-rose-900"
          onClick={handleSystemUpdate}
          disabled={isUpdating}
        >
          {isUpdating ? 'Sedang memperbarui... Harap tunggu' : 'Update Sistem ke Versi Terbaru'}
        </button>
      </section>

      {alertStatus === 'loading' && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" role="alertdialog" aria-busy="true" aria-live="polite">
          <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-xl dark:bg-gray-800">
            <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-cyan-200 border-t-cyan-700" />
            <p className="mt-4 mb-0 text-sm font-bold text-gray-900 dark:text-gray-100">
              Sedang mengunduh pembaruan dan me-restart server...
            </p>
          </div>
        </div>
      )}

      {alertStatus === 'error' && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" role="alertdialog" aria-live="assertive">
          <div className="w-full max-w-md rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center shadow-xl dark:border-rose-900 dark:bg-rose-950">
            <p className="m-0 text-sm font-bold text-rose-800 dark:text-rose-100">{updateError}</p>
            <button
              type="button"
              className="mt-4 h-10 cursor-pointer rounded-lg border-0 bg-rose-600 px-4 text-sm font-bold text-white hover:bg-rose-700"
              onClick={() => setAlertStatus(null)}
            >
              Tutup
            </button>
          </div>
        </div>
      )}

      {alertStatus === 'success' && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" role="status" aria-live="polite">
          <div className="w-full max-w-md rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center shadow-xl dark:border-emerald-900 dark:bg-emerald-950">
            <p className="m-0 text-sm font-bold text-emerald-800 dark:text-emerald-100">Update Berhasil diterapkan!</p>
          </div>
        </div>
      )}

      {editForm && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" role="presentation">
          <form className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-xl dark:border-gray-700 dark:bg-gray-800" onSubmit={handleEdit} role="dialog" aria-labelledby="edit-admin-title">
            <h2 id="edit-admin-title" className="m-0 text-lg font-bold text-gray-900 dark:text-gray-100">Edit Admin</h2>
            <p className="mt-1 mb-0 text-sm text-gray-500 dark:text-gray-400">
              {canSetPassword(editForm.id) ? 'Kosongkan password jika tidak ingin mengubahnya.' : 'Password akun lain tidak dapat diubah dari sini.'}
            </p>
            <div className="mt-5 grid gap-4">
              {editForm.error && <Notice>{editForm.error}</Notice>}
              <TextField
                label="Username"
                name="edit-username"
                autoComplete="off"
                placeholder="Username"
                value={editForm.username}
                onChange={(event) => setEditForm((current) => ({ ...current, username: event.target.value }))}
              />
              {canSetPassword(editForm.id) && (
                <TextField
                  label="Password baru"
                  name="edit-password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Kosongkan jika tidak diubah"
                  value={editForm.password}
                  onChange={(event) => setEditForm((current) => ({ ...current, password: event.target.value }))}
                  required={false}
                />
              )}
              <div className="flex gap-2">
                <button className={buttonClass} type="submit" disabled={editForm.loading}>
                  {editForm.loading ? 'Menyimpan...' : 'Simpan'}
                </button>
                <button
                  type="button"
                  className="h-12 cursor-pointer rounded-xl border border-gray-300 bg-white px-4 text-[15px] font-bold text-gray-700 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200"
                  onClick={() => setEditForm(null)}
                  disabled={editForm.loading}
                >
                  Batal
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </>
  )
}

export default AccountSettings
