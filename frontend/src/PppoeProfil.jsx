import { useEffect, useState } from 'react'
import api from './api/axios.js'
import Swal from 'sweetalert2'
import { fireSuccess } from './swals.js'
import './PppoeProfil.css'

function PppoeProfil() {
  const [profil, setProfil] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [formError, setFormError] = useState('')
  const [groupname, setGroupname] = useState('')
  const [rateLimit, setRateLimit] = useState('')
  const [saving, setSaving] = useState(false)
  const [deletingGroup, setDeletingGroup] = useState('')
  const [editMode, setEditMode] = useState(false)
  const [selectedGroup, setSelectedGroup] = useState('')

  async function fetchProfil() {
    const response = await api.get('/pppoe/profil')
    setProfil(Array.isArray(response.data) ? response.data : [])
    setError('')
  }

  useEffect(() => {
    let ignore = false

    async function loadProfil() {
      try {
        const response = await api.get('/pppoe/profil')
        if (!ignore) {
          setProfil(Array.isArray(response.data) ? response.data : [])
          setError('')
        }
      } catch {
        if (!ignore) {
          setError('Gagal memuat data profil.')
        }
      } finally {
        if (!ignore) {
          setLoading(false)
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
    setSelectedGroup('')
    setGroupname('')
    setRateLimit('')
    setFormError('')
  }

  function handleEdit(item) {
    setEditMode(true)
    setSelectedGroup(item.groupname)
    setGroupname(item.groupname)
    setRateLimit(item.rate_limit)
    setFormError('')
  }

  function notifySuccess(refresh) {
    return fireSuccess({ title: 'Berhasil!', text: 'Data sukses diperbarui' }, refresh)
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
          `/pppoe/profil/${encodeURIComponent(selectedGroup)}`,
          { rate_limit: rateLimit },
        )
      } else {
        await api.post('/pppoe/profil', {
          groupname,
          rate_limit: rateLimit,
        })
      }
      resetForm()
      await notifySuccess(() => { void fetchProfil() })
    } catch (requestError) {
      setFormError(
        requestError.response?.data?.message
        || (editMode ? 'Gagal menyimpan perubahan.' : 'Gagal menyimpan profil.'),
      )
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(targetGroup) {
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

    setDeletingGroup(targetGroup)
    setFormError('')

    try {
      await api.delete(
        `/pppoe/profil/${encodeURIComponent(targetGroup)}`,
      )
      if (selectedGroup === targetGroup) {
        resetForm()
      }
      await notifySuccess(() => { void fetchProfil() })
    } catch (requestError) {
      setFormError(requestError.response?.data?.message || 'Gagal menghapus profil.')
    } finally {
      setDeletingGroup('')
    }
  }

  return (
    <section className="profil">
      <header className="profil-header">
        <p>Group RADIUS</p>
        <h1>Profil Langganan</h1>
      </header>

      <form className="profil-form" onSubmit={handleSubmit}>
        <div className="profil-form-heading">
          <p>{editMode ? 'Ubah data' : 'Profil baru'}</p>
          <h2>{editMode ? 'Edit Profil' : 'Tambah Profil'}</h2>
        </div>

        <div className="profil-form-fields">
          <label className="profil-field">
            <span>Nama Profil</span>
            <input
              type="text"
              name="groupname"
              maxLength={64}
              placeholder="Sama persis dengan PPP Profile di MikroTik"
              value={groupname}
              onChange={(event) => setGroupname(event.target.value)}
              disabled={editMode}
              required
            />
          </label>

          <label className="profil-field">
            <span>Limit Kecepatan (opsional)</span>
            <input
              type="text"
              name="rate_limit"
              placeholder="Kosong = ikut limit di MikroTik, atau 10M/10M"
              value={rateLimit}
              onChange={(event) => setRateLimit(event.target.value)}
            />
          </label>
        </div>

        <div className="profil-form-actions">
          {editMode && (
            <button className="profil-cancel" type="button" onClick={resetForm} disabled={saving}>
              Batal
            </button>
          )}
          <button className="profil-save" type="submit" disabled={saving}>
            {saving ? 'Menyimpan...' : editMode ? 'Simpan Perubahan' : 'Simpan'}
          </button>
        </div>

        {formError && <p className="profil-form-error">{formError}</p>}
      </form>

      <div className="profil-card">
        {loading && <p className="profil-status">Memuat data profil...</p>}
        {error && <p className="profil-status profil-error">{error}</p>}

        {!loading && !error && (
          <div className="profil-table-wrap">
            <table className="profil-table">
              <thead>
                <tr>
                  <th>No</th>
                  <th>Nama Profil</th>
                  <th>Limit Kecepatan</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {profil.length === 0 ? (
                  <tr>
                    <td colSpan="4" className="profil-empty">
                      Belum ada profil.
                    </td>
                  </tr>
                ) : (
                  profil.map((item, index) => (
                    <tr
                      key={`${item.groupname}-${index}`}
                      className={selectedGroup === item.groupname ? 'is-editing' : undefined}
                    >
                      <td>{index + 1}</td>
                      <td>{item.groupname}</td>
                      <td>
                        {item.rate_limit
                          ? <span className="profil-rate">{item.rate_limit}</span>
                          : <span className="profil-rate-mikrotik">Ikut MikroTik</span>}
                      </td>
                      <td>
                        <div className="profil-actions">
                          <button
                            type="button"
                            className="profil-edit"
                            onClick={() => handleEdit(item)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="profil-delete"
                            onClick={() => handleDelete(item.groupname)}
                            disabled={deletingGroup === item.groupname}
                          >
                            {deletingGroup === item.groupname ? 'Menghapus...' : 'Hapus'}
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

export default PppoeProfil
