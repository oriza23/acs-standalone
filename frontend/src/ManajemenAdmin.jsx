import { useEffect, useState } from 'react'
import api from './api/axios.js'
import Swal from 'sweetalert2'
import { fireSuccess } from './swals.js'
import './ManajemenAdmin.css'

const MODAL_OVERLAY =
  'fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm'
const MODAL_CARD =
  'max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl dark:bg-slate-900'

function ManajemenAdmin() {
  const [admins, setAdmins] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('admin')
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [deletingUsername, setDeletingUsername] = useState('')
  const [formError, setFormError] = useState('')
  const [editMode, setEditMode] = useState(false)
  const [selectedUsername, setSelectedUsername] = useState('')
  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false)

  async function fetchAdmins() {
    const response = await api.get('/admins')
    setAdmins(Array.isArray(response.data) ? response.data : [])
    setError('')
  }

  useEffect(() => {
    let ignore = false

    async function loadAdmins() {
      try {
        const response = await api.get('/admins')
        if (!ignore) {
          setAdmins(Array.isArray(response.data) ? response.data : [])
          setError('')
        }
      } catch {
        if (!ignore) {
          setError('Gagal memuat data admin.')
        }
      } finally {
        if (!ignore) {
          setLoading(false)
        }
      }
    }

    loadAdmins()

    return () => {
      ignore = true
    }
  }, [])

  function resetForm() {
    setEditMode(false)
    setSelectedUsername('')
    setUsername('')
    setPassword('')
    setRole('admin')
    setEmail('')
  }

  function closeAdminModal() {
    resetForm()
    setFormError('')
    setIsAdminModalOpen(false)
  }

  function openAddAdminModal() {
    resetForm()
    setFormError('')
    setIsAdminModalOpen(true)
  }

  function handleEdit(item) {
    setEditMode(true)
    setSelectedUsername(item.username)
    setUsername(item.username)
    setPassword('')
    setRole(item.role || 'admin')
    setEmail(item.email || '')
    setFormError('')
    setIsAdminModalOpen(true)
  }

  function notifySuccess(refresh) {
    return fireSuccess({ title: 'Berhasil!', text: 'Data sukses diperbarui' }, refresh)
  }

  async function handleDelete(targetUsername) {
    const result = await Swal.fire({
      title: 'Hapus admin?',
      text: 'Apakah Anda yakin ingin menghapus admin ini? Tindakan ini tidak dapat dibatalkan.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Ya, Hapus!',
      cancelButtonText: 'Batal',
      confirmButtonColor: '#dc2626',
    })
    if (!result.isConfirmed) {
      return
    }

    setDeletingUsername(targetUsername)
    setFormError('')

    try {
      await api.delete(
        `/admins/${encodeURIComponent(targetUsername)}`,
      )
      if (selectedUsername === targetUsername) {
        closeAdminModal()
      }
      await notifySuccess(() => { void fetchAdmins() })
    } catch (error) {
      setFormError(error.response?.data?.message || 'Gagal menghapus admin.')
    } finally {
      setDeletingUsername('')
    }
  }

  async function handleSubmit(event) {
    event.preventDefault()

    const result = await Swal.fire({
      title: 'Simpan Data?',
      text: 'Yakin ingin menyimpan data ini?',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Ya, Simpan!',
      cancelButtonText: 'Batal',
    })
    if (!result.isConfirmed) {
      return
    }

    setSaving(true)
    setFormError('')

    try {
      if (editMode) {
        await api.put(
          `/admins/${encodeURIComponent(selectedUsername)}`,
          { password, role, email: email.trim() },
        )
      } else {
        await api.post('/admins', {
          username,
          password,
          role,
          email: email.trim(),
        })
      }
      resetForm()
      setIsAdminModalOpen(false)
      await notifySuccess(() => { void fetchAdmins() })
    } catch (error) {
      setFormError(
        error.response?.data?.message
          || (editMode ? 'Gagal menyimpan perubahan.' : 'Gagal menyimpan admin.'),
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="admin-page">
      <header className="admin-header">
        <p>Sistem</p>
        <h1>Manajemen Admin</h1>
      </header>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h2 className="m-0 text-lg font-bold text-slate-800 dark:text-gray-100">Daftar Admin</h2>
        <button
          type="button"
          className="inline-flex h-10 items-center justify-center rounded-lg border border-cyan-600 bg-cyan-600 px-4 text-sm font-bold text-white shadow-sm transition-colors hover:bg-cyan-700"
          onClick={openAddAdminModal}
        >
          + Tambah Admin
        </button>
      </div>

      <div className="admin-card">
        {loading && <p className="admin-status">Memuat data admin...</p>}
        {error && <p className="admin-status admin-error">{error}</p>}

        {!loading && !error && (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>No</th>
                  <th>Username</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {admins.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="admin-empty">
                      Belum ada data admin.
                    </td>
                  </tr>
                ) : (
                  admins.map((item, index) => (
                    <tr
                      key={`${item.username}-${index}`}
                      className={selectedUsername === item.username ? 'is-editing' : undefined}
                    >
                      <td>{index + 1}</td>
                      <td>{item.username}</td>
                      <td>{item.email || '-'}</td>
                      <td>
                        <span className="admin-role">{item.role}</span>
                      </td>
                      <td>
                        <div className="admin-actions">
                          <button
                            type="button"
                            className="admin-edit"
                            onClick={() => handleEdit(item)}
                          >
                            Edit
                          </button>
                          {item.username !== 'admin' && (
                            <button
                              type="button"
                              className="admin-delete"
                              onClick={() => handleDelete(item.username)}
                              disabled={deletingUsername === item.username}
                            >
                              {deletingUsername === item.username ? 'Menghapus...' : 'Hapus'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {isAdminModalOpen && (
        <div className={MODAL_OVERLAY} role="dialog" aria-modal="true" aria-labelledby="admin-modal-title">
          <div className={MODAL_CARD}>
            <form className="admin-form admin-form--modal" onSubmit={handleSubmit}>
              <div className="admin-form-heading">
                <p>{editMode ? 'Ubah data' : 'Admin baru'}</p>
                <h2 id="admin-modal-title">{editMode ? 'Edit Admin' : 'Tambah Admin'}</h2>
              </div>

              <div className="admin-form-fields">
                <label className="admin-field">
                  <span>Username</span>
                  <input
                    type="text"
                    name="username"
                    placeholder="Username admin"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    disabled={editMode}
                    required
                  />
                </label>

                <label className="admin-field">
                  <span>Password</span>
                  <input
                    type="password"
                    name="password"
                    placeholder={editMode ? 'Kosongkan jika tidak diganti' : 'Password admin'}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="new-password"
                    required={!editMode}
                  />
                </label>

                <label className="admin-field">
                  <span>Alamat Email</span>
                  <input
                    type="email"
                    name="email"
                    placeholder="admin@contoh.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                    autoComplete="email"
                  />
                </label>

                <label className="admin-field">
                  <span>Role</span>
                  <input
                    type="text"
                    name="role"
                    placeholder="admin"
                    value={role}
                    onChange={(event) => setRole(event.target.value)}
                    required
                  />
                </label>
              </div>

              <div className="admin-form-actions">
                <button className="admin-cancel" type="button" onClick={closeAdminModal} disabled={saving}>
                  Batal
                </button>
                <button className="admin-save" type="submit" disabled={saving}>
                  {saving ? 'Menyimpan...' : editMode ? 'Simpan Perubahan' : 'Simpan Admin'}
                </button>
              </div>

              {formError && <p className="admin-form-error">{formError}</p>}
            </form>
          </div>
        </div>
      )}
    </section>
  )
}

export default ManajemenAdmin
