import { useEffect, useState } from 'react'
import api from './api/axios.js'
import Swal from 'sweetalert2'
import './ManajemenAdmin.css'

function ManajemenAdmin() {
  const [admins, setAdmins] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('admin')
  const [saving, setSaving] = useState(false)
  const [deletingUsername, setDeletingUsername] = useState('')
  const [formError, setFormError] = useState('')
  const [editMode, setEditMode] = useState(false)
  const [selectedUsername, setSelectedUsername] = useState('')

  async function fetchAdmins() {
    const response = await api.get('/api/admins')
    setAdmins(Array.isArray(response.data) ? response.data : [])
    setError('')
  }

  useEffect(() => {
    let ignore = false

    async function loadAdmins() {
      try {
        const response = await api.get('/api/admins')
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
  }

  function handleEdit(item) {
    setEditMode(true)
    setSelectedUsername(item.username)
    setUsername(item.username)
    setPassword('')
    setRole(item.role || 'admin')
    setFormError('')
  }

  function notifySuccess() {
    Swal.fire({
      icon: 'success',
      title: 'Berhasil!',
      text: 'Data sukses diperbarui',
      timer: 1500,
      showConfirmButton: false,
    })
  }

  async function handleDelete(targetUsername) {
    const result = await Swal.fire({
      title: 'Apakah Anda yakin?',
      text: 'Data ini akan dihapus permanen!',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Ya, Hapus!',
      cancelButtonText: 'Batal',
    })
    if (!result.isConfirmed) {
      return
    }

    setDeletingUsername(targetUsername)
    setFormError('')

    try {
      await api.delete(
        `/api/admins/${encodeURIComponent(targetUsername)}`,
      )
      if (selectedUsername === targetUsername) {
        resetForm()
      }
      await fetchAdmins()
      notifySuccess()
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
          `/api/admins/${encodeURIComponent(selectedUsername)}`,
          { password, role },
        )
      } else {
        await api.post('/api/admins', {
          username,
          password,
          role,
        })
      }
      resetForm()
      await fetchAdmins()
      notifySuccess()
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

      <form className="admin-form" onSubmit={handleSubmit}>
        <div className="admin-form-heading">
          <p>{editMode ? 'Ubah data' : 'Admin baru'}</p>
          <h2>{editMode ? 'Edit Admin' : 'Tambah Admin'}</h2>
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
          {editMode && (
            <button className="admin-cancel" type="button" onClick={resetForm} disabled={saving}>
              Batal
            </button>
          )}
          <button className="admin-save" type="submit" disabled={saving}>
            {saving ? 'Menyimpan...' : editMode ? 'Simpan Perubahan' : 'Simpan Admin'}
          </button>
        </div>

        {formError && <p className="admin-form-error">{formError}</p>}
      </form>

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
                  <th>Role</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {admins.length === 0 ? (
                  <tr>
                    <td colSpan="4" className="admin-empty">
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
    </section>
  )
}

export default ManajemenAdmin
