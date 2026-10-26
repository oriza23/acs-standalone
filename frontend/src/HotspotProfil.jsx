import { useEffect, useState } from 'react'
import api from './api/axios.js'
import Swal from 'sweetalert2'
import { Check, Funnel, List, Menu, Pencil, Plus, Search, Trash, Wifi, X } from 'lucide-react'
import './HotspotProfil.css'

const columns = [
  'ID',
  'NAMA PROFILE',
  'GROUP',
  'ADDRESSLIST',
  'RATE LIMIT',
  'SHARED',
  'MASA AKTIF',
  'HPP',
  'KOMISI',
  'HARGA',
]

const emptyForm = {
  nama_profile: '',
  mikrotik_group: '',
  address_list: '',
  rate_limit: '',
  shared: 1,
  masa_aktif: '',
  masa_aktif_satuan: 'HARI',
  harga_jual: '',
  komisi_reseller: '',
}

function displayText(value) {
  if (value === null || value === undefined || String(value).trim() === '') {
    return '-'
  }
  return String(value)
}

function formatMoney(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) {
    return '-'
  }
  return `Rp ${number.toLocaleString('id-ID')}`
}

function HotspotProfil() {
  const [profil, setProfil] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedProfiles, setSelectedProfiles] = useState([])
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [itemsPerPage, setItemsPerPage] = useState(4)
  const [currentPage, setCurrentPage] = useState(1)
  const [searchTerm, setSearchTerm] = useState('')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingGroup, setEditingGroup] = useState('')
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(emptyForm)

  async function fetchProfil() {
    const response = await api.get('/api/hotspot/profil')
    return Array.isArray(response.data) ? response.data : []
  }

  useEffect(() => {
    let ignore = false

    async function loadProfil() {
      try {
        const rows = await fetchProfil()
        if (!ignore) {
          setProfil(rows)
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

  useEffect(() => {
    if (!isMenuOpen) {
      return undefined
    }

    function closeMenu(event) {
      if (!event.target.closest('.hprofil-menu')) {
        setIsMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', closeMenu)
    return () => document.removeEventListener('mousedown', closeMenu)
  }, [isMenuOpen])

  function notifySuccess() {
    Swal.fire({
      icon: 'success',
      title: 'Berhasil!',
      text: 'Data sukses diperbarui',
      timer: 1500,
      showConfirmButton: false,
    })
  }

  function openModal() {
    setEditingGroup('')
    setForm(emptyForm)
    setIsModalOpen(true)
  }

  function openEditSelected() {
    if (selectedProfiles.length === 0) {
      Swal.fire({
        icon: 'warning',
        title: 'Pilih minimal satu data',
      })
      return
    }
    if (selectedProfiles.length > 1) {
      Swal.fire({
        icon: 'warning',
        title: 'Pilih satu profil saja',
      })
      return
    }

    const groupname = selectedProfiles[0]
    const item = profil.find((row) => row.mikrotik_group === groupname)
    if (!item) {
      Swal.fire({
        icon: 'error',
        title: 'Profil tidak ditemukan',
      })
      return
    }

    setEditingGroup(groupname)
    setForm({
      nama_profile: item.nama_profile || '',
      mikrotik_group: item.mikrotik_group || '',
      address_list: item.address_list || '',
      rate_limit: item.rate_limit || '',
      shared: item.shared ?? 1,
      masa_aktif: item.masa_aktif ?? '',
      masa_aktif_satuan: item.masa_aktif_satuan || 'HARI',
      harga_jual: item.harga_jual ?? '',
      komisi_reseller: item.komisi_reseller ?? '',
    })
    setIsMenuOpen(false)
    setIsModalOpen(true)
  }

  function closeModal() {
    if (saving) {
      return
    }
    setIsModalOpen(false)
    setEditingGroup('')
    setForm(emptyForm)
  }

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  function toggleRow(groupname) {
    setSelectedProfiles((current) => (
      current.includes(groupname)
        ? current.filter((item) => item !== groupname)
        : [...current, groupname]
    ))
  }
  const filteredProfiles = profil.filter((profile) => {
    const keyword = searchTerm.toLowerCase()
    return String(profile.nama_profile || '').toLowerCase().includes(keyword)
      || String(profile.mikrotik_group || '').toLowerCase().includes(keyword)
  })
  const totalData = filteredProfiles.length
  const totalPages = Math.max(1, Math.ceil(totalData / itemsPerPage))
  const indexOfLastItem = currentPage * itemsPerPage
  const indexOfFirstItem = indexOfLastItem - itemsPerPage
  const currentItems = filteredProfiles.slice(indexOfFirstItem, indexOfLastItem)
  const showingStart = totalData === 0 ? 0 : indexOfFirstItem + 1
  const showingEnd = Math.min(indexOfLastItem, totalData)
  const pageNumbers = Array.from({ length: totalPages }, (_, index) => index + 1)
  const visibleNames = currentItems.map((item) => item.mikrotik_group)
  const allSelected = visibleNames.length > 0 && visibleNames.every((name) => selectedProfiles.includes(name))

  function toggleAll() {
    if (allSelected) {
      setSelectedProfiles((current) => current.filter((name) => !visibleNames.includes(name)))
      return
    }
    setSelectedProfiles((current) => [...new Set([...current, ...visibleNames])])
  }

  function showStatusLater() {
    setIsMenuOpen(false)
    Swal.fire('Info', 'Fitur status Aktif/Tidak Aktif akan dibangun di langkah selanjutnya.', 'info')
  }

  async function handleSaveProfile(event) {
    event.preventDefault()

    const payload = {
      nama_profile: form.nama_profile.trim(),
      mikrotik_group: form.mikrotik_group.trim(),
      address_list: form.address_list.trim(),
      rate_limit: form.rate_limit.trim(),
      shared: Number(form.shared),
      masa_aktif: Number(form.masa_aktif),
      masa_aktif_satuan: form.masa_aktif_satuan,
      harga_jual: Number(form.harga_jual),
      komisi_reseller: Number(form.komisi_reseller),
    }

    if (!payload.nama_profile || !payload.mikrotik_group || !Number.isInteger(payload.shared) || payload.shared < 1
      || !Number.isInteger(payload.masa_aktif) || payload.masa_aktif < 1
      || !Number.isInteger(payload.harga_jual) || payload.harga_jual < 0
      || !Number.isInteger(payload.komisi_reseller) || payload.komisi_reseller < 0) {
      Swal.fire({
        icon: 'warning',
        title: 'Lengkapi data profil',
      })
      return
    }

    setSaving(true)
    try {
      if (editingGroup) {
        await api.put(`/api/hotspot/profil/${encodeURIComponent(editingGroup)}`, payload)
      } else {
        await api.post('/api/hotspot/profil', payload)
      }
      setIsModalOpen(false)
      setEditingGroup('')
      setForm(emptyForm)
      const rows = await fetchProfil()
      setProfil(rows)
      setCurrentPage(1)
      notifySuccess()
    } catch (requestError) {
      Swal.fire({
        icon: 'error',
        title: 'Gagal',
        text: requestError.response?.data?.message || 'Gagal menyimpan profil.',
      })
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteSelected() {
    if (selectedProfiles.length === 0) {
      Swal.fire({
        icon: 'warning',
        title: 'Pilih minimal satu data',
      })
      return
    }

    const result = await Swal.fire({
      title: `Yakin menghapus ${selectedProfiles.length} profil?`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Ya',
      cancelButtonText: 'Batal',
    })
    if (!result.isConfirmed) {
      return
    }

    try {
      await api.post('/api/hotspot/profil/delete-massal', {
        groupnames: selectedProfiles,
      })
      const rows = await fetchProfil()
      setProfil(rows)
      setSelectedProfiles([])
      setIsMenuOpen(false)
      setCurrentPage(1)
      notifySuccess()
    } catch (requestError) {
      Swal.fire({
        icon: 'error',
        title: 'Gagal',
        text: requestError.response?.data?.message || 'Gagal menghapus profil.',
      })
    }
  }

  function handleItemsPerPage(event) {
    setItemsPerPage(Number(event.target.value))
    setCurrentPage(1)
  }

  return (
    <section className="hprofil">
      <header className="hprofil-head">
        <span className="hprofil-mark" aria-hidden="true">
          <Wifi size={20} strokeWidth={2.2} />
        </span>
        <h1>PROFIL VOUCHER</h1>
      </header>

      <div className="hprofil-bar">
        <div className="hprofil-menu">
          <button
            type="button"
            className="hprofil-btn hprofil-btn-blue"
            aria-expanded={isMenuOpen}
            aria-haspopup="menu"
            onClick={() => setIsMenuOpen((open) => !open)}
          >
            <Menu size={16} strokeWidth={2.2} />
            <span>MENU</span>
          </button>
          {isMenuOpen && (
            <div className="hprofil-dropdown" role="menu">
              <button type="button" role="menuitem" onClick={showStatusLater}>
                <Check size={16} strokeWidth={2.2} />
                <span>Set Aktif</span>
              </button>
              <button type="button" role="menuitem" onClick={showStatusLater}>
                <X size={16} strokeWidth={2.2} />
                <span>Set Tidak Aktif</span>
              </button>
              <button type="button" role="menuitem" onClick={openEditSelected}>
                <Pencil size={16} strokeWidth={2.2} />
                <span>Edit Terpilih</span>
              </button>
              <button type="button" role="menuitem" className="is-danger" onClick={handleDeleteSelected}>
                <Trash size={16} strokeWidth={2.2} />
                <span>Hapus Terpilih</span>
              </button>
            </div>
          )}
        </div>
        <button type="button" className="hprofil-btn hprofil-btn-green" onClick={openModal}>
          <Plus size={16} strokeWidth={2.2} />
          <span>TAMBAH</span>
        </button>

        <label className="hprofil-control">
          <Funnel size={15} strokeWidth={2.2} />
          <select aria-label="Filter status" defaultValue="aktif">
            <option value="aktif">Aktif</option>
          </select>
        </label>

        <label className="hprofil-control hprofil-control-count">
          <List size={15} strokeWidth={2.2} />
          <select
            aria-label="Jumlah baris"
            value={itemsPerPage}
            onChange={handleItemsPerPage}
          >
            <option value={4}>4</option>
            <option value={10}>10</option>
          </select>
        </label>

        <label className="hprofil-search">
          <Search size={16} strokeWidth={2.2} />
          <input
            type="search"
            placeholder="Cari profile..."
            aria-label="Cari profile"
            value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
          />
        </label>
      </div>

      <div className="hprofil-panel">
        {loading && <p className="hprofil-status">Memuat data profil...</p>}
        {error && <p className="hprofil-status hprofil-error">{error}</p>}

        {!loading && !error && (
          <div className="hprofil-table-wrap">
            <table className="hprofil-table">
              <thead>
                <tr>
                  <th className="hprofil-check">
                    <input
                      type="checkbox"
                      aria-label="Pilih semua profil yang tampil"
                      checked={allSelected}
                      onChange={toggleAll}
                    />
                  </th>
                  {columns.map((label) => (
                    <th key={label}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {currentItems.length === 0 ? (
                  <tr>
                    <td colSpan={columns.length + 1} className="hprofil-empty">
                      Belum ada profil.
                    </td>
                  </tr>
                ) : (
                  currentItems.map((item) => (
                    <tr
                      key={item.id}
                      className={selectedProfiles.includes(item.mikrotik_group) ? 'is-selected' : undefined}
                    >
                      <td className="hprofil-check">
                        <input
                          type="checkbox"
                          aria-label={`Pilih ${item.nama_profile}`}
                          checked={selectedProfiles.includes(item.mikrotik_group)}
                          onChange={() => toggleRow(item.mikrotik_group)}
                        />
                      </td>
                      <td>{item.id}</td>
                      <td>
                        <span className="hprofil-name">{displayText(item.nama_profile)}</span>
                      </td>
                      <td>{displayText(item.mikrotik_group)}</td>
                      <td>{displayText(item.address_list)}</td>
                      <td>
                        {item.rate_limit
                          ? <span className="hprofil-rate">{item.rate_limit}</span>
                          : '-'}
                      </td>
                      <td>{displayText(item.shared)}</td>
                      <td>{item.masa_aktif ? `${item.masa_aktif} ${item.masa_aktif_satuan}` : '-'}</td>
                      <td>{formatMoney(item.hpp)}</td>
                      <td>{formatMoney(item.komisi_reseller)}</td>
                      <td>{formatMoney(item.harga_jual)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {!loading && !error && (
          <div className="hprofil-foot">
            <p className="hprofil-info">
              Showing {showingStart} to {showingEnd} of {totalData} entries
            </p>
            <nav className="hprofil-pages" aria-label="Navigasi halaman">
              <button
                type="button"
                className="hprofil-nav"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((page) => page - 1)}
              >
                Previous
              </button>
              {pageNumbers.map((page) => (
                <button
                  key={page}
                  type="button"
                  className={page === currentPage ? 'hprofil-page is-active' : 'hprofil-page'}
                  aria-current={page === currentPage ? 'page' : undefined}
                  onClick={() => setCurrentPage(page)}
                >
                  {page}
                </button>
              ))}
              <button
                type="button"
                className="hprofil-nav"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((page) => page + 1)}
              >
                Next
              </button>
            </nav>
          </div>
        )}
      </div>

      {isModalOpen && (
        <div className="hprofil-backdrop" onMouseDown={closeModal}>
          <div
            className="hprofil-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="hprofil-modal-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="hprofil-modal-head">
              <h2 id="hprofil-modal-title">{editingGroup ? 'Edit Profil' : 'Tambah Profil'}</h2>
              <p>{editingGroup ? 'Perubahan disimpan ke profil yang tercentang.' : 'Group ini akan dipakai sebagai nama profil di MikroTik.'}</p>
            </header>
            <form className="hprofil-form" onSubmit={handleSaveProfile}>
              <label className="hprofil-field">
                <span>Nama profile</span>
                <input
                  type="text"
                  value={form.nama_profile}
                  onChange={(event) => updateForm('nama_profile', event.target.value)}
                  required
                />
              </label>
              <label className="hprofil-field">
                <span>Mikrotik group</span>
                <input
                  type="text"
                  placeholder="Sama persis dengan User Profile di MikroTik"
                  value={form.mikrotik_group}
                  onChange={(event) => updateForm('mikrotik_group', event.target.value)}
                  required
                  readOnly={Boolean(editingGroup)}
                />
              </label>
              <label className="hprofil-field">
                <span>Address list</span>
                <input
                  type="text"
                  value={form.address_list}
                  onChange={(event) => updateForm('address_list', event.target.value)}
                  placeholder="Opsional"
                />
              </label>
              <label className="hprofil-field">
                <span>Mikrotik rate limit (opsional)</span>
                <input
                  type="text"
                  value={form.rate_limit}
                  onChange={(event) => updateForm('rate_limit', event.target.value)}
                  placeholder="Kosong = ikut limit di MikroTik, atau 1M/1M"
                />
              </label>
              <label className="hprofil-field">
                <span>Shared</span>
                <input
                  type="number"
                  min="1"
                  value={form.shared}
                  onChange={(event) => updateForm('shared', event.target.value)}
                  required
                />
              </label>
              <label className="hprofil-field">
                <span>Masa aktif</span>
                <div className="hprofil-duration">
                  <input
                    type="number"
                    min="1"
                    value={form.masa_aktif}
                    onChange={(event) => updateForm('masa_aktif', event.target.value)}
                    required
                  />
                  <select
                    value={form.masa_aktif_satuan}
                    onChange={(event) => updateForm('masa_aktif_satuan', event.target.value)}
                    aria-label="Satuan masa aktif"
                  >
                    <option value="JAM">JAM</option>
                    <option value="HARI">HARI</option>
                    <option value="BULAN">BULAN</option>
                  </select>
                </div>
              </label>
              <label className="hprofil-field">
                <span>Harga Jual</span>
                <input
                  type="number"
                  min="0"
                  value={form.harga_jual}
                  onChange={(event) => updateForm('harga_jual', event.target.value)}
                  required
                />
              </label>
              <label className="hprofil-field">
                <span>Komisi Reseller</span>
                <input
                  type="number"
                  min="0"
                  value={form.komisi_reseller}
                  onChange={(event) => updateForm('komisi_reseller', event.target.value)}
                  required
                />
              </label>
              <div className="hprofil-modal-actions">
                <button type="button" className="hprofil-btn hprofil-btn-gray" onClick={closeModal} disabled={saving}>
                  Batal
                </button>
                <button type="submit" className="hprofil-btn hprofil-btn-blue" disabled={saving}>
                  {saving ? 'Menyimpan...' : 'Simpan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  )
}

export default HotspotProfil
