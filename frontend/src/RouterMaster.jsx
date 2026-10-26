import { useEffect, useState } from 'react'
import api from './api/axios.js'
import Swal from 'sweetalert2'
import './PppoeProfil.css'
import './RouterMaster.css'

const API_URL = '/api/routers'
const SERVER_URL = '/api/routers/servers'
const JENIS_LABEL = { hotspot: 'Hotspot', pppoe: 'PPPoE' }

const emptyForm = {
  namaRouter: '',
  ipAddress: '',
  secret: '',
  deskripsi: '',
}

function RouterMaster() {
  const [routers, setRouters] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [editMode, setEditMode] = useState(false)
  const [selectedId, setSelectedId] = useState(null)
  const [servers, setServers] = useState([])
  const [serverForm, setServerForm] = useState({ routerId: '', jenis: '', nama: '' })
  const [serverSaving, setServerSaving] = useState(false)
  const [deletingServerId, setDeletingServerId] = useState(null)

  async function fetchRouters() {
    const response = await api.get(API_URL)
    setRouters(Array.isArray(response.data) ? response.data : [])
    setError('')
  }

  async function fetchServers() {
    const response = await api.get(SERVER_URL)
    setServers(Array.isArray(response.data) ? response.data : [])
  }

  useEffect(() => {
    let ignore = false

    async function loadRouters() {
      try {
        const [response, serverResponse] = await Promise.all([
          api.get(API_URL),
          api.get(SERVER_URL),
        ])
        if (!ignore) {
          setRouters(Array.isArray(response.data) ? response.data : [])
          setServers(Array.isArray(serverResponse.data) ? serverResponse.data : [])
          setError('')
        }
      } catch {
        if (!ignore) {
          setError('Gagal memuat data router.')
        }
      } finally {
        if (!ignore) {
          setLoading(false)
        }
      }
    }

    loadRouters()

    return () => {
      ignore = true
    }
  }, [])

  function updateField(key, value) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function resetForm() {
    setEditMode(false)
    setSelectedId(null)
    setForm(emptyForm)
  }

  function handleEdit(item) {
    setEditMode(true)
    setSelectedId(item.id)
    setForm({
      namaRouter: item.nama_router || '',
      ipAddress: item.ip_address || '',
      secret: item.secret || '',
      deskripsi: item.deskripsi || '',
    })
  }

  function notifySuccess(text) {
    Swal.fire({
      icon: 'success',
      title: 'Berhasil!',
      text,
      timer: 1500,
      showConfirmButton: false,
    })
  }

  function notifyError(errorResponse, fallback) {
    Swal.fire({
      icon: 'error',
      title: 'Gagal',
      text: errorResponse?.response?.data?.message || fallback,
    })
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

    const payload = {
      nama_router: form.namaRouter.trim(),
      ip_address: form.ipAddress.trim(),
      secret: form.secret.trim(),
      deskripsi: form.deskripsi.trim(),
    }

    setSaving(true)
    try {
      if (editMode) {
        await api.put(`${API_URL}/${selectedId}`, payload)
      } else {
        await api.post(API_URL, payload)
      }
      resetForm()
      await fetchRouters()
      notifySuccess('Data sukses diperbarui')
    } catch (requestError) {
      notifyError(requestError, editMode ? 'Gagal menyimpan perubahan.' : 'Gagal menyimpan router.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(item) {
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

    setDeletingId(item.id)
    try {
      await api.delete(`${API_URL}/${item.id}`)
      if (selectedId === item.id) {
        resetForm()
      }
      await Promise.all([fetchRouters(), fetchServers()])
      notifySuccess('Data sukses diperbarui')
    } catch (requestError) {
      notifyError(requestError, 'Gagal menghapus router.')
    } finally {
      setDeletingId(null)
    }
  }

  function updateServerField(key, value) {
    setServerForm((current) => ({ ...current, [key]: value }))
  }

  async function handleServerSubmit(event) {
    event.preventDefault()

    const nama = serverForm.nama.trim()
    if (!serverForm.routerId || !serverForm.jenis || !nama) {
      Swal.fire({
        icon: 'warning',
        title: 'Data belum lengkap',
        text: 'Pilih router, jenis server, dan isi nama server.',
      })
      return
    }

    setServerSaving(true)
    try {
      await api.post(`${API_URL}/${serverForm.routerId}/servers`, {
        jenis: serverForm.jenis,
        nama,
      })
      // Router dan jenis dipertahankan supaya beberapa server bisa diinput berurutan.
      setServerForm((current) => ({ ...current, nama: '' }))
      await fetchServers()
      notifySuccess('Server berhasil disimpan')
    } catch (requestError) {
      notifyError(requestError, 'Gagal menyimpan server.')
    } finally {
      setServerSaving(false)
    }
  }

  async function handleServerDelete(item) {
    const result = await Swal.fire({
      title: 'Hapus server?',
      text: `Server "${item.nama}" hilang dari pilihan Buat VC dan registrasi pelanggan. Voucher dan pelanggan yang sudah memakainya tidak berubah.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Ya, Hapus!',
      cancelButtonText: 'Batal',
    })
    if (!result.isConfirmed) {
      return
    }

    setDeletingServerId(item.id)
    try {
      await api.delete(`${SERVER_URL}/${item.id}`)
      await fetchServers()
      notifySuccess('Server berhasil dihapus')
    } catch (requestError) {
      notifyError(requestError, 'Gagal menghapus server.')
    } finally {
      setDeletingServerId(null)
    }
  }

  return (
    <section className="profil router-page">
      <header className="profil-header">
        <p>Infrastruktur</p>
        <h1>Manajemen Router</h1>
      </header>

      <form className="profil-form" onSubmit={handleSubmit}>
        <div className="profil-form-heading">
          <p>{editMode ? 'Ubah data' : 'Router baru'}</p>
          <h2>{editMode ? 'Edit Router' : 'Tambah Router'}</h2>
        </div>

        <div className="profil-form-fields">
          <label className="profil-field">
            <span>Nama Router</span>
            <input
              type="text"
              name="nama_router"
              placeholder="Nama router"
              value={form.namaRouter}
              onChange={(event) => updateField('namaRouter', event.target.value)}
              required
            />
          </label>

          <label className="profil-field">
            <span>IP Address</span>
            <input
              type="text"
              name="ip_address"
              placeholder="192.168.88.1"
              value={form.ipAddress}
              onChange={(event) => updateField('ipAddress', event.target.value)}
              required
            />
          </label>

          <label className="profil-field">
            <span>Secret RADIUS</span>
            <input
              type="password"
              name="secret"
              placeholder="Secret RADIUS"
              value={form.secret}
              onChange={(event) => updateField('secret', event.target.value)}
              autoComplete="new-password"
              required
            />
          </label>

          <label className="profil-field">
            <span>Deskripsi</span>
            <input
              type="text"
              name="deskripsi"
              placeholder="Keterangan router"
              value={form.deskripsi}
              onChange={(event) => updateField('deskripsi', event.target.value)}
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
      </form>

      <div className="profil-card">
        {loading && <p className="profil-status">Memuat data router...</p>}
        {error && <p className="profil-status profil-error">{error}</p>}

        {!loading && !error && (
          <div className="profil-table-wrap">
            <table className="profil-table">
              <thead>
                <tr>
                  <th>No</th>
                  <th>Nama Router</th>
                  <th>IP Address</th>
                  <th>Secret</th>
                  <th>Deskripsi</th>
                  <th>Status</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {routers.length === 0 ? (
                  <tr>
                    <td colSpan="7" className="profil-empty">
                      Belum ada router.
                    </td>
                  </tr>
                ) : (
                  routers.map((item, index) => (
                    <tr
                      key={item.id}
                      className={selectedId === item.id ? 'is-editing' : undefined}
                    >
                      <td>{index + 1}</td>
                      <td>{item.nama_router}</td>
                      <td>{item.ip_address}</td>
                      <td className="password-cell">
                        <span className="pwd-masked">••••••••</span>
                        <span className="pwd-revealed">{item.secret}</span>
                      </td>
                      <td>{item.deskripsi || '-'}</td>
                      <td>
                        <span className="router-status">{item.status || 'Aktif'}</span>
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
                            onClick={() => handleDelete(item)}
                            disabled={deletingId === item.id}
                          >
                            {deletingId === item.id ? 'Menghapus...' : 'Hapus'}
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

      <form className="profil-form" onSubmit={handleServerSubmit}>
        <div className="profil-form-heading">
          <p>Server per router</p>
          <h2>Tambah Server</h2>
        </div>

        <div className="profil-form-fields">
          <label className="profil-field">
            <span>Router</span>
            <select
              name="router_id"
              value={serverForm.routerId}
              onChange={(event) => updateServerField('routerId', event.target.value)}
            >
              <option value="">-Pilih-</option>
              {routers.map((item) => (
                <option key={item.id} value={item.id}>{item.nama_router}</option>
              ))}
            </select>
          </label>

          <label className="profil-field">
            <span>Jenis Server</span>
            <select
              name="jenis"
              value={serverForm.jenis}
              onChange={(event) => updateServerField('jenis', event.target.value)}
            >
              <option value="">-Pilih-</option>
              <option value="hotspot">Hotspot</option>
              <option value="pppoe">PPPoE</option>
            </select>
          </label>

          <label className="profil-field">
            <span>{serverForm.jenis === 'pppoe' ? 'Service Name' : 'Nama Server'}</span>
            <input
              type="text"
              name="nama"
              maxLength="100"
              placeholder={serverForm.jenis === 'pppoe'
                ? 'Sama dengan PPP > PPPoE Servers > Service Name'
                : 'Sama dengan IP > Hotspot > Servers > Name'}
              value={serverForm.nama}
              onChange={(event) => updateServerField('nama', event.target.value)}
            />
          </label>
        </div>

        <p className="server-hint">
          Isi persis seperti di MikroTik (huruf besar kecil dibedakan). Hotspot: IP &gt; Hotspot &gt; Servers &gt; Name.
          PPPoE: PPP &gt; PPPoE Servers &gt; Service Name. Pilihan &quot;ALL SERVER&quot; selalu tersedia di form lain.
        </p>

        <div className="profil-form-actions">
          <button className="profil-save" type="submit" disabled={serverSaving}>
            {serverSaving ? 'Menyimpan...' : 'Simpan Server'}
          </button>
        </div>
      </form>

      <div className="profil-card">
        {!loading && !error && (
          <div className="profil-table-wrap">
            <table className="profil-table">
              <thead>
                <tr>
                  <th>No</th>
                  <th>Router</th>
                  <th>Jenis</th>
                  <th>Nama Server</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {servers.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="profil-empty">
                      Belum ada server.
                    </td>
                  </tr>
                ) : (
                  servers.map((item, index) => (
                    <tr key={item.id}>
                      <td>{index + 1}</td>
                      <td>{item.nama_router}</td>
                      <td>{JENIS_LABEL[item.jenis] || item.jenis}</td>
                      <td>{item.nama}</td>
                      <td>
                        <div className="profil-actions">
                          <button
                            type="button"
                            className="profil-delete"
                            onClick={() => handleServerDelete(item)}
                            disabled={deletingServerId === item.id}
                          >
                            {deletingServerId === item.id ? 'Menghapus...' : 'Hapus'}
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

export default RouterMaster
