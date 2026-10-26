import { useEffect, useState } from 'react'
import api from './api/axios.js'
import Swal from 'sweetalert2'
import { Menu, Pencil, Plus, Search, Trash, X } from 'lucide-react'
import './HotspotStok.css'
import './LanggananProfil.css'

const API = '/api/langganan/profil'
const TIPE_OPTIONS = ['Rumahan', 'Bisnis', 'Kantor', 'Sekolah']
const MEDIA_OPTIONS = ['Fiber Optic', 'Wireless', 'LAN', 'Radio']
const HARGA_PALET = [
  { background: '#dbeafe', color: '#1d4ed8' },
  { background: '#fce7f3', color: '#be185d' },
  { background: '#ffedd5', color: '#c2410c' },
  { background: '#dcfce7', color: '#15803d' },
  { background: '#ede9fe', color: '#6d28d9' },
  { background: '#cffafe', color: '#0e7490' },
]

function formatRupiah(value) {
  const number = Number(value) || 0
  return `Rp${number.toLocaleString('id-ID')}`
}

function emptyForm() {
  return {
    nama_profile: '',
    warna_dot: '#2563eb',
    tipe: 'Rumahan',
    media: 'Fiber Optic',
    group_name: '',
    rate_limit: '',
    shared: '1',
    masa_aktif: '30 Hari',
    hpp: '',
    komisi: '',
    harga: '',
  }
}

function formFromProfile(item) {
  return {
    nama_profile: item.nama_profile || '',
    warna_dot: item.warna_dot || '#000000',
    tipe: item.tipe || 'Rumahan',
    media: item.media || 'Fiber Optic',
    group_name: item.group_name || '',
    rate_limit: item.rate_limit || '',
    shared: String(item.shared ?? 1),
    masa_aktif: item.masa_aktif || '30 Hari',
    hpp: item.hpp ?? '',
    komisi: item.komisi ?? '',
    harga: item.harga ?? '',
  }
}

function uniqueValues(rows, key) {
  return [...new Set(rows.map((row) => String(row[key] || '').trim()).filter(Boolean))]
}

function LanggananProfil() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [filterTipe, setFilterTipe] = useState('all')
  const [filterMedia, setFilterMedia] = useState('all')
  const [filterAktif, setFilterAktif] = useState('all')
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage, setItemsPerPage] = useState(10)
  const [selectedIds, setSelectedIds] = useState([])
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  async function loadProfiles() {
    const response = await api.get(API)
    setRows(Array.isArray(response.data) ? response.data : [])
    setError('')
  }

  useEffect(() => {
    let ignore = false

    async function load() {
      try {
        const response = await api.get(API)
        if (!ignore) {
          setRows(Array.isArray(response.data) ? response.data : [])
          setError('')
        }
      } catch {
        if (!ignore) {
          setRows([])
          setError('Gagal memuat profil langganan.')
        }
      } finally {
        if (!ignore) {
          setLoading(false)
        }
      }
    }

    load()
    return () => {
      ignore = true
    }
  }, [])

  useEffect(() => {
    if (!isMenuOpen) {
      return undefined
    }
    function closeMenu(event) {
      if (!event.target.closest('.langganan-menu')) {
        setIsMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', closeMenu)
    return () => document.removeEventListener('mousedown', closeMenu)
  }, [isMenuOpen])

  const keyword = searchTerm.toLowerCase()
  const filteredRows = rows.filter((item) => {
    const matchesSearch = !keyword || [
      item.nama_profile,
      item.tipe,
      item.media,
      item.group_name,
      item.rate_limit,
      item.masa_aktif,
    ].some((value) => String(value || '').toLowerCase().includes(keyword))
    const matchesTipe = filterTipe === 'all' || item.tipe === filterTipe
    const matchesMedia = filterMedia === 'all' || item.media === filterMedia
    const matchesAktif = filterAktif === 'all' || item.masa_aktif === filterAktif
    return matchesSearch && matchesTipe && matchesMedia && matchesAktif
  })

  const totalData = filteredRows.length
  const totalPages = Math.max(1, Math.ceil(totalData / itemsPerPage))
  const page = Math.min(currentPage, totalPages)
  const lastIndex = page * itemsPerPage
  const firstIndex = lastIndex - itemsPerPage
  const currentItems = filteredRows.slice(firstIndex, lastIndex)
  const showingStart = totalData === 0 ? 0 : firstIndex + 1
  const showingEnd = Math.min(lastIndex, totalData)
  const pageNumbers = Array.from({ length: totalPages }, (_, index) => index + 1)
  const visibleIds = currentItems.map((item) => item.id)
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id))
  const selectedRows = rows.filter((item) => selectedIds.includes(item.id))
  const tipeOptions = uniqueValues(rows, 'tipe')
  const mediaOptions = uniqueValues(rows, 'media')
  const aktifOptions = uniqueValues(rows, 'masa_aktif')

  function updateForm(key, value) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function toggleRow(id) {
    setSelectedIds((current) => (
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    ))
  }

  function toggleAll() {
    if (visibleIds.length === 0) {
      return
    }
    if (visibleIds.every((id) => selectedIds.includes(id))) {
      setSelectedIds((current) => current.filter((id) => !visibleIds.includes(id)))
      return
    }
    setSelectedIds((current) => [...new Set([...current, ...visibleIds])])
  }

  function openCreate() {
    setEditingId(null)
    setForm(emptyForm())
    setIsModalOpen(true)
    setIsMenuOpen(false)
  }

  function openEdit() {
    if (selectedRows.length !== 1) {
      Swal.fire('Pilih profil', 'Pilih satu profil untuk diedit.', 'warning')
      return
    }
    setEditingId(selectedRows[0].id)
    setForm(formFromProfile(selectedRows[0]))
    setIsModalOpen(true)
    setIsMenuOpen(false)
  }

  function closeModal() {
    if (saving) {
      return
    }
    setIsModalOpen(false)
    setEditingId(null)
    setForm(emptyForm())
  }

  async function handleSave(event) {
    event.preventDefault()
    if (!form.nama_profile.trim()) {
      Swal.fire('Data belum lengkap', 'Nama profile wajib diisi.', 'warning')
      return
    }
    if (!form.group_name.trim()) {
      Swal.fire('Data belum lengkap', 'Group wajib diisi dan harus sama persis dengan nama profil di MikroTik.', 'warning')
      return
    }
    const payload = {
      ...form,
      nama_profile: form.nama_profile.trim(),
      group_name: form.group_name.trim(),
      rate_limit: form.rate_limit.trim(),
      shared: Number(form.shared),
      hpp: form.hpp === '' ? 0 : form.hpp,
      komisi: form.komisi === '' ? 0 : form.komisi,
      harga: form.harga === '' ? 0 : form.harga,
    }
    setSaving(true)
    Swal.fire({
      title: 'Menyimpan...',
      allowOutsideClick: false,
      didOpen: () => {
        Swal.showLoading()
      },
    })
    try {
      if (editingId) {
        await api.put(`${API}/${encodeURIComponent(editingId)}`, payload)
      } else {
        await api.post(API, payload)
      }
      await loadProfiles()
      setIsModalOpen(false)
      setEditingId(null)
      setForm(emptyForm())
      setSelectedIds([])
      Swal.fire({
        icon: 'success',
        title: 'Berhasil',
        text: editingId ? 'Profil langganan berhasil diperbarui.' : 'Profil langganan berhasil disimpan.',
        timer: 1500,
        showConfirmButton: false,
      })
    } catch (error) {
      Swal.fire('Gagal', error.response?.data?.message || 'Profil gagal disimpan.', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteSelected() {
    if (selectedRows.length === 0) {
      Swal.fire('Pilih profil', 'Pilih minimal satu profil.', 'warning')
      setIsMenuOpen(false)
      return
    }
    setIsMenuOpen(false)
    const confirm = await Swal.fire({
      title: selectedRows.length === 1
        ? 'Yakin menghapus profil ini?'
        : `Yakin menghapus ${selectedRows.length} profil terpilih?`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Ya, hapus',
      cancelButtonText: 'Batal',
      confirmButtonColor: '#e11d48',
    })
    if (!confirm.isConfirmed) {
      return
    }
    Swal.fire({
      title: 'Menghapus...',
      allowOutsideClick: false,
      didOpen: () => {
        Swal.showLoading()
      },
    })
    try {
      await Promise.all(selectedRows.map((item) => api.delete(`${API}/${encodeURIComponent(item.id)}`)))
      await loadProfiles()
      setSelectedIds([])
      Swal.fire({
        icon: 'success',
        title: 'Terhapus',
        text: 'Profil langganan berhasil dihapus.',
        timer: 1500,
        showConfirmButton: false,
      })
    } catch (error) {
      Swal.fire('Gagal', error.response?.data?.message || 'Profil gagal dihapus.', 'error')
    }
  }

  return (
    <section className="stok langganan">
      <div className="langganan-toolbar">
        <div className="langganan-menu">
          <button
            type="button"
            className="stok-action stok-action-blue"
            aria-expanded={isMenuOpen}
            aria-haspopup="menu"
            onClick={() => setIsMenuOpen((open) => !open)}
          >
            <Menu size={16} strokeWidth={2.2} />
            <span>MENU</span>
          </button>
          {isMenuOpen && (
            <div className="stok-dropdown" role="menu">
              <button type="button" role="menuitem" onClick={openEdit}>
                <Pencil size={16} />
                <span>Edit Terpilih</span>
              </button>
              <button type="button" role="menuitem" className="is-danger" onClick={handleDeleteSelected}>
                <Trash size={16} />
                <span>Hapus Terpilih</span>
              </button>
            </div>
          )}
        </div>
        <button type="button" className="stok-action stok-action-green" onClick={openCreate}>
          <Plus size={16} strokeWidth={2.2} />
          <span>TAMBAH</span>
        </button>
        <select
          aria-label="Semua tipe"
          value={filterTipe}
          onChange={(event) => {
            setFilterTipe(event.target.value)
            setCurrentPage(1)
          }}
        >
          <option value="all">Semua tipe</option>
          {tipeOptions.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
        <select
          aria-label="Semua media"
          value={filterMedia}
          onChange={(event) => {
            setFilterMedia(event.target.value)
            setCurrentPage(1)
          }}
        >
          <option value="all">Semua media</option>
          {mediaOptions.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
        <select
          aria-label="Aktif"
          value={filterAktif}
          onChange={(event) => {
            setFilterAktif(event.target.value)
            setCurrentPage(1)
          }}
        >
          <option value="all">Aktif</option>
          {aktifOptions.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
        <select
          aria-label="Jumlah baris"
          value={itemsPerPage}
          onChange={(event) => {
            setItemsPerPage(Number(event.target.value))
            setCurrentPage(1)
          }}
        >
          <option value="10">10</option>
          <option value="13">13</option>
          <option value="25">25</option>
        </select>
        <label className="stok-search">
          <Search size={16} strokeWidth={2} />
          <input
            type="search"
            placeholder="Cari profile..."
            aria-label="Cari profile"
            value={searchTerm}
            onChange={(event) => {
              setSearchTerm(event.target.value)
              setCurrentPage(1)
            }}
          />
        </label>
      </div>

      <div className="stok-panel">
        <div className="stok-panel-head">
          <div>
            <p>Langganan</p>
            <h1>Profil Langganan</h1>
          </div>
          <span>{loading ? 'Memuat...' : `${totalData} profil`}</span>
        </div>

        {loading && <p className="stok-status">Memuat data profil...</p>}
        {error && <p className="stok-status stok-error">{error}</p>}

        {!loading && !error && (
          <div className="stok-table-wrap">
            <table className="langganan-table">
              <thead>
                <tr>
                  <th className="stok-check">
                    <input
                      type="checkbox"
                      aria-label="Pilih semua profil"
                      checked={allSelected}
                      onChange={toggleAll}
                    />
                  </th>
                  <th>NAMA PROFILE</th>
                  <th>TIPE</th>
                  <th>MEDIA</th>
                  <th>GROUP</th>
                  <th>RATE LIMIT</th>
                  <th>SHARED</th>
                  <th>AKTIF</th>
                  <th>HPP</th>
                  <th>KOMISI</th>
                  <th>HARGA</th>
                  <th>PELANGGAN</th>
                </tr>
              </thead>
              <tbody>
                {currentItems.length === 0 ? (
                  <tr>
                    <td colSpan="12" className="stok-empty">
                      {searchTerm || filterTipe !== 'all' || filterMedia !== 'all' || filterAktif !== 'all'
                        ? 'Profil tidak ditemukan.'
                        : 'Belum ada profil langganan.'}
                    </td>
                  </tr>
                ) : (
                  currentItems.map((item, index) => {
                    const tone = HARGA_PALET[(Number(item.id) + index) % HARGA_PALET.length]
                    return (
                      <tr key={item.id} className={selectedIds.includes(item.id) ? 'is-selected' : undefined}>
                        <td className="stok-check">
                          <input
                            type="checkbox"
                            aria-label={`Pilih ${item.nama_profile}`}
                            checked={selectedIds.includes(item.id)}
                            onChange={() => toggleRow(item.id)}
                          />
                        </td>
                        <td>
                          <span className="langganan-name">
                            <span
                              className="langganan-dot"
                              style={{ background: item.warna_dot || '#000000' }}
                              aria-hidden="true"
                            />
                            {item.nama_profile}
                          </span>
                        </td>
                        <td>{item.tipe || '-'}</td>
                        <td>{item.media || '-'}</td>
                        <td>{item.group_name || '-'}</td>
                        <td>{item.rate_limit || '-'}</td>
                        <td>{item.shared}</td>
                        <td>{item.masa_aktif || '-'}</td>
                        <td>{formatRupiah(item.hpp)}</td>
                        <td>{formatRupiah(item.komisi)}</td>
                        <td>
                          <span
                            className="langganan-harga"
                            style={{ background: tone.background, color: tone.color }}
                          >
                            {formatRupiah(item.harga)}
                          </span>
                        </td>
                        <td>
                          <span className="langganan-pelanggan">{item.jumlah_pelanggan ?? 0}</span>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {!loading && !error && (
          <div className="stok-foot">
            <p className="stok-info">
              Showing {showingStart} to {showingEnd} of {totalData} entries
            </p>
            <nav className="stok-pages" aria-label="Navigasi halaman profil langganan">
              <button type="button" className="stok-nav" disabled={page <= 1} onClick={() => setCurrentPage(page - 1)}>
                Previous
              </button>
              {pageNumbers.map((pageNumber) => (
                <button
                  key={pageNumber}
                  type="button"
                  className={pageNumber === page ? 'stok-page is-active' : 'stok-page'}
                  aria-current={pageNumber === page ? 'page' : undefined}
                  onClick={() => setCurrentPage(pageNumber)}
                >
                  {pageNumber}
                </button>
              ))}
              <button type="button" className="stok-nav" disabled={page >= totalPages} onClick={() => setCurrentPage(page + 1)}>
                Next
              </button>
            </nav>
          </div>
        )}
      </div>

      {isModalOpen && (
        <div className="langganan-backdrop" onMouseDown={closeModal}>
          <form
            className="langganan-modal"
            onSubmit={handleSave}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="langganan-modal-head">
              <div>
                <p>Langganan</p>
                <h2>{editingId ? 'Edit Profil' : 'Tambah Profil'}</h2>
              </div>
              <button type="button" className="langganan-close" onClick={closeModal} aria-label="Tutup">
                <X size={18} />
              </button>
            </header>
            <div className="langganan-form-grid">
              <label>
                Nama Profile
                <input
                  value={form.nama_profile}
                  onChange={(event) => updateForm('nama_profile', event.target.value)}
                  required
                />
              </label>
              <label>
                Warna Penanda
                <span className="langganan-color">
                  <input
                    type="color"
                    aria-label="Warna penanda"
                    value={/^#[0-9A-Fa-f]{6}$/.test(form.warna_dot) ? form.warna_dot : '#000000'}
                    onChange={(event) => updateForm('warna_dot', event.target.value)}
                  />
                  <input
                    value={form.warna_dot}
                    onChange={(event) => updateForm('warna_dot', event.target.value)}
                    placeholder="#000000"
                  />
                </span>
              </label>
              <label>
                Tipe
                <select value={form.tipe} onChange={(event) => updateForm('tipe', event.target.value)}>
                  {[...new Set([form.tipe, ...TIPE_OPTIONS])].filter(Boolean).map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </label>
              <label>
                Media
                <select value={form.media} onChange={(event) => updateForm('media', event.target.value)}>
                  {[...new Set([form.media, ...MEDIA_OPTIONS])].filter(Boolean).map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </label>
              <label>
                Group <span style={{ color: '#dc2626' }} aria-hidden="true">*</span>
                <input
                  value={form.group_name}
                  onChange={(event) => updateForm('group_name', event.target.value)}
                  placeholder="Sama persis dengan PPP Profile di MikroTik"
                  maxLength={64}
                  required
                />
              </label>
              <label>
                Rate Limit (opsional)
                <input
                  value={form.rate_limit}
                  onChange={(event) => updateForm('rate_limit', event.target.value)}
                  placeholder="Kosong = ikut limit di MikroTik, atau 10M/10M"
                />
              </label>
              <label>
                Shared
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={form.shared}
                  onChange={(event) => updateForm('shared', event.target.value)}
                  required
                />
              </label>
              <label>
                Masa Aktif
                <input
                  value={form.masa_aktif}
                  onChange={(event) => updateForm('masa_aktif', event.target.value)}
                  placeholder="30 Hari"
                />
              </label>
              <label>
                HPP
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={form.hpp}
                  onChange={(event) => updateForm('hpp', event.target.value)}
                />
              </label>
              <label>
                Komisi
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={form.komisi}
                  onChange={(event) => updateForm('komisi', event.target.value)}
                />
              </label>
              <label>
                Harga
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={form.harga}
                  onChange={(event) => updateForm('harga', event.target.value)}
                />
              </label>
            </div>
            <div className="langganan-modal-actions">
              <button type="button" className="langganan-btn langganan-btn-gray" onClick={closeModal} disabled={saving}>
                Batal
              </button>
              <button type="submit" className="langganan-btn langganan-btn-blue" disabled={saving}>
                Simpan
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  )
}

export default LanggananProfil
