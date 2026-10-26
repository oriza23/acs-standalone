import { useEffect, useMemo, useRef, useState } from 'react'
import api from './api/axios.js'
import ServerPagination from './ServerPagination.jsx'
import Swal from 'sweetalert2'
import * as XLSX from 'xlsx'
import { Download, KeyRound, LogIn, Menu, Plus, Search, X } from 'lucide-react'

const API = '/api/pelanggan'

const actionBtn = 'inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border-0 px-3.5 text-xs font-bold tracking-wide text-white shadow-md transition-colors duration-300'
const fieldClass = 'grid min-w-0 gap-1.5 text-xs font-semibold tracking-wide text-gray-600 dark:text-gray-300'
const controlClass = 'box-border w-full min-w-0 rounded-lg border border-gray-300 bg-gray-50 px-3 text-sm font-medium text-gray-900 outline-none transition-colors duration-300 focus:border-blue-800 focus:bg-white focus:ring-2 focus:ring-blue-800/20 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:focus:bg-gray-900'
const thClass = 'bg-sky-900 px-3 py-3 text-left text-xs font-bold tracking-wide text-sky-50 uppercase whitespace-nowrap'
const tdClass = 'border-b border-gray-100 px-3 py-3 text-left text-sm whitespace-nowrap text-gray-800 dark:border-gray-700 dark:text-gray-100'
const rowAction = 'inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border-0 px-2.5 text-xs font-bold text-white transition-colors duration-300'

function emptyForm() {
  return {
    nama_pelanggan: '',
    phone: '',
    identitas: '',
    npwp: '',
    alamat: '',
    saldo: '0',
    mitra: 'SYSTEM',
  }
}

function formatRupiah(value) {
  const number = Number(value) || 0
  return `Rp${number.toLocaleString('id-ID')}`
}

function formatTanggal(value) {
  if (!value) {
    return '-'
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return '-'
  }
  const pad = (part) => String(part).padStart(2, '0')
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function tampil(value) {
  const text = String(value || '').trim()
  return text || '-'
}

function statusBadge(status) {
  const aktif = status === 'Aktif'
  return (
    <span className={aktif
      ? 'inline-flex rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
      : 'inline-flex rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-bold text-rose-700 dark:bg-rose-950 dark:text-rose-200'}
    >
      {aktif ? 'Aktif' : 'Tidak Aktif'}
    </span>
  )
}

function validatePelangganForm(form) {
  const errors = []
  const nama = form.nama_pelanggan.trim()
  const phoneRaw = form.phone.trim()
  const identitas = form.identitas.trim()
  const alamat = form.alamat.trim()

  if (!nama) {
    errors.push('Nama Pelanggan wajib diisi.')
  } else if (!/^[a-zA-Z\s]+$/.test(nama)) {
    errors.push('Nama Pelanggan hanya boleh berisi huruf dan spasi.')
  }

  if (!phoneRaw) {
    errors.push('Phone / WhatsApp wajib diisi.')
  }

  if (!identitas) {
    errors.push('Identitas / NIK wajib diisi.')
  } else if (!/^\d{11}$/.test(identitas)) {
    errors.push('Identitas / NIK wajib tepat 11 digit angka, tanpa huruf atau karakter lain.')
  }

  if (!alamat) {
    errors.push('Alamat wajib diisi.')
  } else if (!/^[a-zA-Z0-9\s.\-]{1,30}$/.test(alamat)) {
    errors.push('Alamat maksimal 30 karakter dan hanya boleh berisi huruf, angka, spasi, titik, atau garis datar.')
  }

  return {
    errors,
    nama,
    phone: phoneRaw.replace(/^0/, '62'),
    identitas,
    alamat,
  }
}

function showPending(title) {
  Swal.fire('Info', `${title} belum terhubung ke akun login pelanggan.`, 'info')
}

function DataPelanggan({ open, onClose }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage, setItemsPerPage] = useState(10)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [userId, setUserId] = useState('')
  const [saving, setSaving] = useState(false)
  const [selectedRows, setSelectedRows] = useState([])
  const formOpenRef = useRef(false)
  const onCloseRef = useRef(onClose)
  formOpenRef.current = isFormOpen
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) {
      return undefined
    }
    let ignore = false
    setLoading(true)
    setError('')

    api.get(API)
      .then((response) => {
        if (!ignore) {
          setRows(Array.isArray(response.data) ? response.data : [])
        }
      })
      .catch(() => {
        if (!ignore) {
          setRows([])
          setError('Gagal memuat data pelanggan.')
        }
      })
      .finally(() => {
        if (!ignore) {
          setLoading(false)
        }
      })

    return () => {
      ignore = true
    }
  }, [open])

  useEffect(() => {
    if (!open) {
      return undefined
    }
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKey(event) {
      if (event.key !== 'Escape') {
        return
      }
      if (formOpenRef.current) {
        setIsFormOpen(false)
        return
      }
      onCloseRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const filtered = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    if (!term) {
      return rows
    }
    return rows.filter((item) => [
      item.user_id,
      item.nama_pelanggan,
      item.phone,
      item.identitas,
      item.npwp,
      item.alamat,
      item.mitra,
    ].some((value) => String(value || '').toLowerCase().includes(term)))
  }, [rows, searchTerm])

  const totalData = filtered.length
  const totalPages = Math.max(1, Math.ceil(totalData / itemsPerPage))
  const page = Math.min(currentPage, totalPages)
  const currentItems = filtered.slice((page - 1) * itemsPerPage, page * itemsPerPage)
  const allSelected = currentItems.length > 0 && currentItems.every((item) => selectedRows.includes(item.id))

  function updateField(name, value) {
    setForm((current) => ({ ...current, [name]: value }))
  }

  function toggleRow(id) {
    setSelectedRows((current) => (
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    ))
  }

  function toggleAll() {
    setSelectedRows((current) => {
      if (allSelected) {
        const visible = new Set(currentItems.map((item) => item.id))
        return current.filter((id) => !visible.has(id))
      }
      return [...new Set([...current, ...currentItems.map((item) => item.id)])]
    })
  }

  async function loadNextId() {
    const response = await api.get(`${API}/next-id`)
    const nextId = String(response.data?.user_id || '')
    setUserId(nextId)
    return nextId
  }

  useEffect(() => {
    if (!isFormOpen) {
      return undefined
    }
    let ignore = false
    setUserId('')
    loadNextId().catch(() => {
      if (!ignore) {
        setUserId('')
      }
    })
    return () => {
      ignore = true
    }
  }, [isFormOpen])

  function openCreate() {
    setForm(emptyForm())
    setUserId('')
    setIsMenuOpen(false)
    setIsFormOpen(true)
  }

  function closeForm() {
    if (saving) {
      return
    }
    setIsFormOpen(false)
    setForm(emptyForm())
  }

  async function loadData() {
    const response = await api.get(API)
    setRows(Array.isArray(response.data) ? response.data : [])
    setError('')
  }

  async function refreshRows() {
    await loadData()
    setSelectedRows([])
    setIsMenuOpen(false)
  }

  async function handleSetStatus(status) {
    setIsMenuOpen(false)
    if (selectedRows.length === 0) {
      Swal.fire('Pilih pelanggan', 'Centang minimal satu pelanggan.', 'warning')
      return
    }
    try {
      await api.put(`${API}/bulk-status`, { ids: selectedRows, status })
      await refreshRows()
      Swal.fire({
        icon: 'success',
        title: 'Berhasil',
        text: `Status diubah menjadi ${status}.`,
        timer: 1500,
        showConfirmButton: false,
      })
    } catch (requestError) {
      Swal.fire('Gagal', requestError.response?.data?.message || 'Status gagal diubah.', 'error')
    }
  }

  async function handleBulkDelete() {
    setIsMenuOpen(false)
    if (selectedRows.length === 0) {
      Swal.fire('Pilih pelanggan', 'Centang minimal satu pelanggan.', 'warning')
      return
    }
    const result = await Swal.fire({
      title: 'Hapus pelanggan terpilih?',
      text: `${selectedRows.length} data akan dihapus permanen dan tidak bisa dikembalikan.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Ya, hapus',
      cancelButtonText: 'Batal',
      confirmButtonColor: '#e11d48',
    })
    if (!result.isConfirmed) {
      return
    }
    try {
      await api.delete(`${API}/bulk-delete`, { data: { ids: selectedRows } })
      await refreshRows()
      Swal.fire({
        icon: 'success',
        title: 'Terhapus',
        text: 'Pelanggan terpilih sudah dihapus.',
        timer: 1500,
        showConfirmButton: false,
      })
    } catch (requestError) {
      Swal.fire('Gagal', requestError.response?.data?.message || 'Pelanggan gagal dihapus.', 'error')
    }
  }

  function handleExport() {
    if (filtered.length === 0) {
      Swal.fire('Kosong', 'Tidak ada data untuk diexport', 'warning')
      return
    }
    const sheet = filtered.map((item) => ({
      'User ID': item.user_id,
      Pelanggan: item.nama_pelanggan,
      Phone: item.phone,
      Identitas: item.identitas,
      NPWP: item.npwp,
      Alamat: item.alamat,
      Saldo: Number(item.saldo) || 0,
      Mitra: item.mitra,
      Status: item.status || 'Aktif',
      'Last Login': item.last_login ? formatTanggal(item.last_login) : '',
    }))
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(sheet), 'Data Pelanggan')
    XLSX.writeFile(workbook, 'data-pelanggan.xlsx')
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (saving) {
      return
    }
    if (!/^\d{7}$/.test(userId)) {
      Swal.fire({
        icon: 'warning',
        title: 'User ID belum siap',
        text: 'Tunggu nomor User ID selesai dimuat, lalu simpan lagi.',
      })
      return
    }
    const { errors, nama, phone, identitas, alamat } = validatePelangganForm(form)
    if (errors.length > 0) {
      Swal.fire({
        icon: 'warning',
        title: 'Periksa kembali isian',
        html: `<ul style="text-align:left;margin:0;padding-left:1.2rem">${errors.map((item) => `<li>${item}</li>`).join('')}</ul>`,
      })
      return
    }

    setSaving(true)
    Swal.fire({
      title: 'Menyimpan...',
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      didOpen: () => {
        Swal.showLoading()
      },
    })

    try {
      const response = await api.post(API, {
        user_id: userId,
        nama_pelanggan: nama,
        phone,
        identitas,
        npwp: form.npwp.trim(),
        alamat,
        saldo: form.saldo === '' ? 0 : Number(form.saldo),
        mitra: form.mitra.trim() || 'SYSTEM',
      })
      setForm(emptyForm())
      setIsFormOpen(false)
      setCurrentPage(1)
      await loadData()
      Swal.fire({
        icon: 'success',
        title: 'Berhasil',
        text: response.data?.user_id
          ? `Pelanggan disimpan dengan User ID ${response.data.user_id}.`
          : 'Data pelanggan berhasil disimpan.',
        timer: 1600,
        showConfirmButton: false,
      })
    } catch (requestError) {
      Swal.fire('Gagal', requestError.response?.data?.message || 'Data pelanggan gagal disimpan.', 'error')
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 h-full w-full overflow-y-auto bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-gray-200 bg-white/95 px-4 py-3 backdrop-blur-sm md:px-6 dark:border-gray-700 dark:bg-gray-900/95">
        <div>
          <p className="m-0 text-xs font-bold tracking-[0.12em] text-cyan-700 uppercase dark:text-cyan-300">Langganan</p>
          <h2 className="m-0 mt-0.5 text-xl font-bold tracking-tight">Data Pelanggan</h2>
        </div>
        <button
          type="button"
          className="grid h-10 w-10 cursor-pointer place-items-center rounded-lg border-0 bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
          aria-label="Tutup data pelanggan"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>

      <div className="p-4 md:p-6">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative">
            <button
              type="button"
              className={`${actionBtn} bg-blue-600 hover:bg-blue-500`}
              aria-expanded={isMenuOpen}
              aria-haspopup="menu"
              onClick={() => setIsMenuOpen((current) => !current)}
            >
              <Menu size={16} strokeWidth={2.2} />
              <span>MENU</span>
            </button>
            {isMenuOpen && (
              <div className="absolute left-0 z-20 mt-2 min-w-44 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800" role="menu">
                <button type="button" role="menuitem" className="block w-full cursor-pointer border-0 bg-transparent px-4 py-2.5 text-left text-sm font-semibold text-emerald-700 hover:bg-gray-50 dark:text-emerald-300 dark:hover:bg-gray-700" onClick={() => handleSetStatus('Aktif')}>
                  Set Aktif
                </button>
                <button type="button" role="menuitem" className="block w-full cursor-pointer border-0 bg-transparent px-4 py-2.5 text-left text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700" onClick={() => handleSetStatus('Tidak Aktif')}>
                  Set Tidak Aktif
                </button>
                <button type="button" role="menuitem" className="block w-full cursor-pointer border-0 bg-transparent px-4 py-2.5 text-left text-sm font-semibold text-rose-600 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-gray-700" onClick={handleBulkDelete}>
                  Hapus
                </button>
              </div>
            )}
          </div>
          <button type="button" className={`${actionBtn} bg-cyan-700 hover:bg-cyan-600`} onClick={handleExport}>
            <Download size={16} strokeWidth={2.2} />
            <span>EXPORT</span>
          </button>
          <button type="button" className={`${actionBtn} bg-emerald-600 hover:bg-emerald-500`} onClick={openCreate}>
            <Plus size={16} strokeWidth={2.2} />
            <span>TAMBAH</span>
          </button>
          <select
            aria-label="Jumlah baris"
            className="box-border h-10 rounded-lg border border-gray-300 bg-white px-2 text-sm text-gray-800 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            value={itemsPerPage}
            onChange={(event) => {
              setItemsPerPage(Number(event.target.value))
              setCurrentPage(1)
            }}
          >
            <option value="10">10</option>
            <option value="20">20</option>
            <option value="50">50</option>
            <option value="100">100</option>
            <option value="500">500</option>
          </select>
          <label className="ml-auto flex h-10 w-full min-w-0 items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 text-gray-500 sm:w-auto sm:min-w-56 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300">
            <Search size={16} strokeWidth={2} />
            <input
              type="search"
              className="w-full border-0 bg-transparent text-sm text-gray-900 outline-none dark:text-gray-100"
              placeholder="Cari pelanggan..."
              aria-label="Cari pelanggan"
              value={searchTerm}
              onChange={(event) => {
                setSearchTerm(event.target.value)
                setCurrentPage(1)
              }}
            />
          </label>
        </div>

        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
            <span className="text-sm font-semibold text-gray-500 dark:text-gray-400">
              {loading ? 'Memuat...' : `${totalData.toLocaleString('id-ID')} pelanggan`}
            </span>
          </div>

          {loading && <p className="m-0 px-4 py-6 text-sm text-gray-500">Memuat data pelanggan...</p>}
          {error && <p className="m-0 px-4 py-6 text-sm font-semibold text-rose-700">{error}</p>}

          {!loading && !error && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] border-collapse">
                <thead>
                  <tr>
                    <th className={thClass}>
                      <input
                        type="checkbox"
                        aria-label="Pilih semua pelanggan"
                        checked={allSelected}
                        onChange={toggleAll}
                      />
                    </th>
                    <th className={thClass}>User ID</th>
                    <th className={thClass}>Pelanggan</th>
                    <th className={thClass}>Status</th>
                    <th className={thClass}>Phone</th>
                    <th className={thClass}>Identitas</th>
                    <th className={thClass}>NPWP</th>
                    <th className={thClass}>Alamat</th>
                    <th className={thClass}>Saldo</th>
                    <th className={thClass}>Mitra</th>
                    <th className={thClass}>Last Login</th>
                    <th className={thClass}>Auto Login</th>
                    <th className={thClass}>Reset PW</th>
                  </tr>
                </thead>
                <tbody>
                  {currentItems.length === 0 ? (
                    <tr>
                      <td colSpan="13" className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                        {searchTerm ? 'Pelanggan tidak ditemukan.' : 'Belum ada data pelanggan.'}
                      </td>
                    </tr>
                  ) : currentItems.map((item) => (
                    <tr key={item.id} className={selectedRows.includes(item.id) ? 'bg-sky-50 dark:bg-sky-950/40' : 'hover:bg-gray-50 dark:hover:bg-gray-700/40'}>
                      <td className={tdClass}>
                        <input
                          type="checkbox"
                          aria-label={`Pilih ${item.nama_pelanggan}`}
                          checked={selectedRows.includes(item.id)}
                          onChange={() => toggleRow(item.id)}
                        />
                      </td>
                      <td className={`${tdClass} font-semibold`}>{item.user_id}</td>
                      <td className={tdClass}>{item.nama_pelanggan}</td>
                      <td className={tdClass}>{statusBadge(item.status)}</td>
                      <td className={tdClass}>{tampil(item.phone)}</td>
                      <td className={tdClass}>{tampil(item.identitas)}</td>
                      <td className={tdClass}>{tampil(item.npwp)}</td>
                      <td className={`${tdClass} max-w-64 truncate`}>{tampil(item.alamat)}</td>
                      <td className={tdClass}>{formatRupiah(item.saldo)}</td>
                      <td className={tdClass}>{tampil(item.mitra)}</td>
                      <td className={tdClass}>{formatTanggal(item.last_login)}</td>
                      <td className={tdClass}>
                        <button type="button" className={`${rowAction} bg-sky-700 hover:bg-sky-600`} onClick={() => showPending('Auto login')}>
                          <LogIn size={14} />
                          <span>Auto</span>
                        </button>
                      </td>
                      <td className={tdClass}>
                        <button type="button" className={`${rowAction} bg-rose-600 hover:bg-rose-500`} onClick={() => showPending('Reset password')}>
                          <KeyRound size={14} />
                          <span>Reset</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!loading && !error && (
            <ServerPagination
              page={page}
              totalPages={totalPages}
              totalData={totalData}
              limit={itemsPerPage}
              onPageChange={setCurrentPage}
              label="Navigasi halaman data pelanggan"
            />
          )}
        </div>
      </div>

      {isFormOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/50 p-4 sm:p-6"
          onMouseDown={closeForm}
        >
          <div
            className="max-h-[calc(100vh-3rem)] w-full max-w-4xl overflow-auto rounded-2xl bg-white text-gray-900 shadow-2xl dark:bg-gray-800 dark:text-gray-100"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pelanggan-modal-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="flex items-start justify-between gap-4 px-6 pt-6">
              <div>
                <p className="m-0 text-xs font-bold tracking-[0.12em] text-cyan-700 uppercase dark:text-cyan-300">Pelanggan</p>
                <h2 id="pelanggan-modal-title" className="m-0 mt-1 text-xl font-bold tracking-wide">Tambah Pelanggan</h2>
              </div>
              <button
                type="button"
                className="grid h-9 w-9 cursor-pointer place-items-center rounded-lg border-0 bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600"
                aria-label="Tutup"
                onClick={closeForm}
              >
                <X size={18} />
              </button>
            </header>

            <form className="grid gap-6 px-6 pt-5 pb-6" onSubmit={handleSubmit}>
              <label className={fieldClass}>
                <span>User ID</span>
                <input
                  className="box-border h-10 w-full min-w-0 cursor-not-allowed rounded-lg border border-gray-300 bg-gray-100 px-3 text-sm font-medium text-gray-500 outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400"
                  value={userId}
                  readOnly
                  aria-readonly="true"
                  tabIndex={-1}
                />
              </label>
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <label className={fieldClass}>
                  <span>Nama Pelanggan <span className="text-red-500">*</span></span>
                  <input className={`${controlClass} h-10`} value={form.nama_pelanggan} onChange={(event) => updateField('nama_pelanggan', event.target.value)} maxLength={100} />
                </label>
                <label className={fieldClass}>
                  <span>Phone / WhatsApp <span className="text-red-500">*</span></span>
                  <input className={`${controlClass} h-10`} value={form.phone} onChange={(event) => updateField('phone', event.target.value)} maxLength={20} inputMode="tel" />
                </label>
                <label className={fieldClass}>
                  <span>Identitas / NIK <span className="text-red-500">*</span></span>
                  <input className={`${controlClass} h-10`} value={form.identitas} onChange={(event) => updateField('identitas', event.target.value)} maxLength={11} inputMode="numeric" />
                </label>
                <label className={fieldClass}>
                  <span>NPWP</span>
                  <input className={`${controlClass} h-10`} value={form.npwp} onChange={(event) => updateField('npwp', event.target.value)} maxLength={50} />
                </label>
              </div>
              <label className={fieldClass}>
                <span>Alamat <span className="text-red-500">*</span></span>
                <textarea className={`${controlClass} min-h-24 resize-y py-2`} value={form.alamat} onChange={(event) => updateField('alamat', event.target.value)} rows={3} maxLength={30} />
              </label>
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <label className={fieldClass}>
                  <span>Saldo Awal</span>
                  <input className={`${controlClass} h-10`} type="number" min="0" step="0.01" value={form.saldo} onChange={(event) => updateField('saldo', event.target.value)} />
                </label>
                <label className={fieldClass}>
                  <span>Mitra</span>
                  <input className={`${controlClass} h-10`} value={form.mitra} onChange={(event) => updateField('mitra', event.target.value)} maxLength={50} />
                </label>
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" className="inline-flex h-10 cursor-pointer items-center rounded-lg border-0 bg-gray-200 px-4 text-sm font-bold text-gray-800 hover:bg-gray-300 disabled:opacity-70 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600" onClick={closeForm} disabled={saving}>Batal</button>
                <button type="submit" className="inline-flex h-10 cursor-pointer items-center rounded-lg border-0 bg-emerald-600 px-4 text-sm font-bold text-white hover:bg-emerald-500 disabled:cursor-wait disabled:opacity-70" disabled={saving}>Simpan</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default DataPelanggan
