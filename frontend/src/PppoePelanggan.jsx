import { useEffect, useState } from 'react'
import api from './api/axios.js'
import Swal from 'sweetalert2'
import './PppoePelanggan.css'

function PppoePelanggan() {
  const [pelanggan, setPelanggan] = useState([])
  const [daftarProfil, setDaftarProfil] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [paket, setPaket] = useState('')
  const [saving, setSaving] = useState(false)
  const [deletingUsername, setDeletingUsername] = useState('')
  const [formError, setFormError] = useState('')
  const [editMode, setEditMode] = useState(false)
  const [selectedUsername, setSelectedUsername] = useState('')

  async function fetchPelanggan() {
    const response = await api.get('/api/pppoe/pelanggan')
    setPelanggan(Array.isArray(response.data) ? response.data : [])
    setError('')
  }

  useEffect(() => {
    let ignore = false

    async function loadPelanggan() {
      try {
        const response = await api.get('/api/pppoe/pelanggan')
        if (!ignore) {
          setPelanggan(Array.isArray(response.data) ? response.data : [])
          setError('')
        }
      } catch {
        if (!ignore) {
          setError('Gagal memuat data pelanggan.')
        }
      } finally {
        if (!ignore) {
          setLoading(false)
        }
      }
    }

    loadPelanggan()

    return () => {
      ignore = true
    }
  }, [])

  useEffect(() => {
    let ignore = false

    async function loadProfil() {
      try {
        const response = await api.get('/api/pppoe/profil')
        if (ignore) {
          return
        }

        const rows = Array.isArray(response.data) ? response.data : []
        setDaftarProfil(rows)
        setPaket((current) => {
          if (rows.some((item) => item.groupname === current)) {
            return current
          }
          return rows[0]?.groupname || ''
        })
      } catch {
        if (!ignore) {
          setFormError('Gagal memuat daftar profil.')
        }
      }
    }

    loadProfil()

    return () => {
      ignore = true
    }
  }, [])

  function resetForm() {
    setEditMode(false)
    setSelectedUsername('')
    setUsername('')
    setPassword('')
    setPaket(daftarProfil[0]?.groupname || '')
  }

  function handleEdit(item) {
    setEditMode(true)
    setSelectedUsername(item.username)
    setUsername(item.username)
    setPassword(item.password)
    setPaket(item.paket || daftarProfil[0]?.groupname || '')
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
        `/api/pppoe/pelanggan/${encodeURIComponent(targetUsername)}`,
      )
      if (selectedUsername === targetUsername) {
        resetForm()
      }
      await fetchPelanggan()
      notifySuccess()
    } catch {
      setFormError('Gagal menghapus pelanggan.')
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
          `/api/pppoe/pelanggan/${encodeURIComponent(selectedUsername)}`,
          { password, paket },
        )
      } else {
        await api.post('/api/pppoe/pelanggan', {
          username,
          password,
          paket,
        })
      }
      resetForm()
      await fetchPelanggan()
      notifySuccess()
    } catch {
      setFormError(editMode ? 'Gagal menyimpan perubahan.' : 'Gagal menyimpan pelanggan.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="pelanggan">
      <header className="pelanggan-header">
        <p>Data RADIUS</p>
        <h1>Data Langganan</h1>
      </header>

      <form className="pelanggan-form" onSubmit={handleSubmit}>
        <div className="pelanggan-form-heading">
          <p>{editMode ? 'Ubah data' : 'Pelanggan baru'}</p>
          <h2>{editMode ? 'Edit Pelanggan' : 'Tambah Pelanggan'}</h2>
        </div>

        <div className="pelanggan-form-fields">
          <label className="pelanggan-field">
            <span>Username</span>
            <input
              type="text"
              name="username"
              placeholder="Username pelanggan"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              disabled={editMode}
              required
            />
          </label>

          <label className="pelanggan-field">
            <span>Password</span>
            <input
              type="text"
              name="password"
              placeholder="Password pelanggan"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>

          <label className="pelanggan-field">
            <span>Paket Kecepatan</span>
            <select
              name="paket"
              value={paket}
              onChange={(event) => setPaket(event.target.value)}
              required
            >
              {paket && !daftarProfil.some((item) => item.groupname === paket) && (
                <option value={paket}>{paket}</option>
              )}
              {daftarProfil.map((item) => (
                <option key={item.groupname} value={item.groupname}>
                  {item.groupname}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="pelanggan-form-actions">
          {editMode && (
            <button className="pelanggan-cancel" type="button" onClick={resetForm} disabled={saving}>
              Batal
            </button>
          )}
          <button className="pelanggan-save" type="submit" disabled={saving}>
            {saving ? 'Menyimpan...' : editMode ? 'Simpan Perubahan' : 'Simpan Pelanggan'}
          </button>
        </div>

        {formError && <p className="pelanggan-form-error">{formError}</p>}
      </form>

      <div className="pelanggan-card">
        {loading && <p className="pelanggan-status">Memuat data pelanggan...</p>}
        {error && <p className="pelanggan-status pelanggan-error">{error}</p>}

        {!loading && !error && (
          <div className="pelanggan-table-wrap">
            <table className="pelanggan-table">
              <thead>
                <tr>
                  <th>No</th>
                  <th>Username</th>
                  <th>Password</th>
                  <th>Paket</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {pelanggan.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="pelanggan-empty">
                      Belum ada data pelanggan.
                    </td>
                  </tr>
                ) : (
                  pelanggan.map((item, index) => (
                    <tr
                      key={`${item.username}-${index}`}
                      className={selectedUsername === item.username ? 'is-editing' : undefined}
                    >
                      <td>{index + 1}</td>
                      <td>{item.username}</td>
                      <td>{item.password}</td>
                      <td>
                        <span className="pelanggan-paket">{item.paket}</span>
                      </td>
                      <td>
                        <div className="pelanggan-actions">
                          <button
                            type="button"
                            className="pelanggan-edit"
                            onClick={() => handleEdit(item)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="pelanggan-delete"
                            onClick={() => handleDelete(item.username)}
                            disabled={deletingUsername === item.username}
                          >
                            {deletingUsername === item.username ? 'Menghapus...' : 'Hapus'}
                          </button>
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

export default PppoePelanggan
