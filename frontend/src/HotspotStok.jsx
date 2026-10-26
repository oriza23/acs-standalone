import { useEffect, useRef, useState } from 'react'
import api from './api/axios.js'
import ServerPagination from './ServerPagination.jsx'
import useDebouncedValue from './useDebouncedValue.js'
import Swal from 'sweetalert2'
import {
  Banknote,
  Calendar,
  Check,
  FileClock,
  HandCoins,
  Menu,
  Package,
  Plus,
  Printer,
  Search,
  Settings,
  Store,
  TicketPlus,
  Trash,
  UserPlus,
  Wallet,
  X,
} from 'lucide-react'

const iconTone = {
  blue: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
  teal: 'bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-200',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  indigo: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200',
}

const actionTone = {
  blue: 'bg-blue-600 hover:bg-blue-500',
  red: 'bg-rose-600 hover:bg-rose-500',
  green: 'bg-emerald-600 hover:bg-emerald-500',
  navy: 'bg-blue-900 hover:bg-blue-800',
  ink: 'bg-gray-800 hover:bg-gray-700',
  rose: 'bg-rose-400 hover:bg-rose-300',
  orange: 'bg-orange-500 hover:bg-orange-400',
}

const actionBtn = 'inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border-0 px-3.5 text-xs font-bold tracking-wide text-white shadow-md transition-colors duration-300'
const fieldClass = 'grid min-w-0 gap-1.5 text-xs font-semibold tracking-wide text-gray-600 dark:text-gray-300'
const controlClass = 'box-border h-10 w-full min-w-0 rounded-lg border border-gray-300 bg-gray-50 px-3 text-sm font-medium text-gray-900 outline-none transition-colors duration-300 focus:border-blue-800 focus:bg-white focus:ring-2 focus:ring-blue-800/20 read-only:bg-gray-100 read-only:text-gray-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:focus:bg-gray-900 dark:read-only:bg-gray-950 dark:read-only:text-gray-400'
const modalShell = 'max-h-[calc(100vh-3rem)] w-full overflow-auto rounded-2xl bg-white text-gray-900 shadow-2xl transition-colors duration-300 dark:bg-gray-800 dark:text-gray-100'
const modalBtn = 'inline-flex h-10 cursor-pointer items-center justify-center rounded-lg border-0 px-4 text-sm font-bold text-white transition-colors duration-300 disabled:cursor-wait disabled:opacity-70'
const ALL_SERVER = 'ALL SERVER'
const requiredMark = <span className="text-red-600" aria-hidden="true">*</span>
const VOUCHER_JENIS = ['username=password', 'username+password']
const VOUCHER_KODE = ['huruf-kecil', 'huruf-besar', 'huruf-campuran', 'angka-huruf']
const thClass = 'bg-sky-900 px-4 py-3 text-left text-xs font-bold tracking-wide text-sky-50 uppercase whitespace-nowrap'
const tdClass = 'border-b border-gray-100 px-4 py-3 text-left text-sm whitespace-nowrap text-gray-800 dark:border-gray-700 dark:text-gray-100'

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
    return String(value)
  }
  const pad = (part) => String(part).padStart(2, '0')
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function formatTanggalGabung(value) {
  if (!value) {
    return '-'
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-')
    return `${day}/${month}/${year}`
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return String(value)
  }
  const pad = (part) => String(part).padStart(2, '0')
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`
}

function emptyFormOutlet() {
  return {
    nama_outlet: '',
    pemilik: '',
    phone: '',
    alamat: '',
    tgl_gabung: new Date().toISOString().split('T')[0],
  }
}

function sumColumn(rows, key) {
  return rows.reduce((total, row) => total + (Number(row[key]) || 0), 0)
}

const summaryCards = [
  { label: 'Total Stok', hint: 'Voucher tersedia', icon: Package, tone: 'blue', key: 'stok' },
  { label: 'Total HPP', hint: 'Harga pokok', icon: Wallet, tone: 'teal', key: 'hpp' },
  { label: 'Total Komisi', hint: 'Bagian mitra', icon: HandCoins, tone: 'amber', key: 'komisi' },
  { label: 'Total Harga', hint: 'Nilai jual', icon: Banknote, tone: 'indigo', key: 'harga' },
]

const toolbar = [
  { label: 'PRINT', icon: Printer, tone: 'red' },
  { label: 'BUAT USER', icon: UserPlus, tone: 'green' },
  { label: 'BUAT VC', icon: TicketPlus, tone: 'navy' },
  { label: 'OUTLET', icon: Store, tone: 'ink' },
  { label: 'SETTING', icon: Settings, tone: 'rose' },
  { label: 'RIWAYAT', icon: FileClock, tone: 'orange' },
]

function HotspotStok() {
  const [daftarProfil, setDaftarProfil] = useState([])
  const [daftarRouter, setDaftarRouter] = useState([])
  const [daftarOutletAktif, setDaftarOutletAktif] = useState([])
  const [selectedOutlet, setSelectedOutlet] = useState('')
  const [selectedRouter, setSelectedRouter] = useState('')
  const [selectedServer, setSelectedServer] = useState('')
  const [daftarServer, setDaftarServer] = useState([])
  const [vouchers, setVouchers] = useState([])
  const [totalData, setTotalData] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [voucherSummary, setVoucherSummary] = useState({
    total_stok: 0, total_hpp: 0, total_komisi: 0, total_harga: 0,
  })
  const [loading, setLoading] = useState(true)
  const [fetching, setFetching] = useState(false)
  const [error, setError] = useState('')
  const [mikrotikGroup, setMikrotikGroup] = useState('')
  const [jumlah, setJumlah] = useState(10)
  const [prefix, setPrefix] = useState('')
  const [panjang, setPanjang] = useState(6)
  const [jenisVoucher, setJenisVoucher] = useState('')
  const [kodeKombinasi, setKodeKombinasi] = useState('')
  // Garis merah baru tampil setelah admin menekan Generate dengan isian bermasalah.
  const [voucherSubmitted, setVoucherSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  // Kunci sinkron anti klik ganda (state React baru update setelah render).
  const generatingRef = useRef(false)
  // Voucher terpilih disimpan lengkap (username -> baris) agar tetap bisa
  // di-print/dihapus walau admin berpindah halaman.
  const [selectedMap, setSelectedMap] = useState({})
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isModalBuatVcOpen, setIsModalBuatVcOpen] = useState(false)
  const [isModalOutletOpen, setIsModalOutletOpen] = useState(false)
  const [daftarOutlet, setDaftarOutlet] = useState([])
  const [isOutletMenuOpen, setIsOutletMenuOpen] = useState(false)
  const [searchOutlet, setSearchOutlet] = useState('')
  const [isModalTambahOutletOpen, setIsModalTambahOutletOpen] = useState(false)
  const [formOutlet, setFormOutlet] = useState(emptyFormOutlet)
  const [outletPage, setOutletPage] = useState(1)
  const [outletPerPage, setOutletPerPage] = useState(10)
  const [selectedOutlets, setSelectedOutlets] = useState([])
  const [outletLoading, setOutletLoading] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage, setItemsPerPage] = useState(10)

  const debouncedSearch = useDebouncedValue(searchTerm.trim())

  function applyVoucherResponse(payload) {
    setVouchers(Array.isArray(payload?.data) ? payload.data : [])
    setTotalData(Number(payload?.total) || 0)
    setTotalPages(Math.max(1, Number(payload?.total_pages) || 1))
    if (payload?.summary) {
      setVoucherSummary(payload.summary)
    }
    setError('')
  }

  // Muat ulang halaman tertentu (mis. halaman 1 setelah generate) dengan filter aktif.
  async function fetchVouchers(targetPage = currentPage) {
    const response = await api.get('/api/hotspot/voucher', {
      params: { page: targetPage, limit: itemsPerPage, q: searchTerm.trim() },
    })
    applyVoucherResponse(response.data)
    setCurrentPage(response.data.page)
  }

  // Server-side pagination: hanya satu halaman data yang diminta dari backend.
  useEffect(() => {
    let ignore = false

    async function loadPage() {
      setFetching(true)
      try {
        const response = await api.get('/api/hotspot/voucher', {
          params: { page: currentPage, limit: itemsPerPage, q: debouncedSearch },
        })
        if (ignore) {
          return
        }
        applyVoucherResponse(response.data)
        if (response.data.page !== currentPage) {
          setCurrentPage(response.data.page)
        }
      } catch {
        if (!ignore) {
          setError('Gagal memuat data voucher.')
        }
      } finally {
        if (!ignore) {
          setLoading(false)
          setFetching(false)
        }
      }
    }

    loadPage()
    return () => {
      ignore = true
    }
  }, [currentPage, itemsPerPage, debouncedSearch])

  useEffect(() => {
    let ignore = false

    async function loadData() {
      try {
        const [profilResponse, outletResponse] = await Promise.all([
          api.get('/api/hotspot/profil'),
          api.get('/api/outlets').catch(() => ({ data: [] })),
        ])
        if (ignore) {
          return
        }

        const profiles = Array.isArray(profilResponse.data) ? profilResponse.data : []
        const outlets = Array.isArray(outletResponse.data) ? outletResponse.data : []
        setDaftarProfil(profiles)
        setDaftarOutletAktif(outlets.filter((item) => item.status === 'Aktif'))
        setError('')
      } catch {
        if (!ignore) {
          setError('Gagal memuat data profil.')
        }
      }
    }

    loadData()

    return () => {
      ignore = true
    }
  }, [])

  useEffect(() => {
    let ignore = false

    async function loadRouters() {
      try {
        const response = await api.get('/api/routers')
        if (!ignore) {
          setDaftarRouter(Array.isArray(response.data) ? response.data : [])
        }
      } catch {
        if (!ignore) {
          setDaftarRouter([])
        }
      }
      // Server Hotspot yang diinput admin di menu Router.
      try {
        const response = await api.get('/api/routers/servers', { params: { jenis: 'hotspot' } })
        if (!ignore) {
          setDaftarServer(Array.isArray(response.data) ? response.data : [])
        }
      } catch {
        if (!ignore) {
          setDaftarServer([])
        }
      }
    }

    loadRouters()

    return () => {
      ignore = true
    }
  }, [])

  function notifySuccess(text) {
    Swal.fire({
      icon: 'success',
      title: 'Berhasil!',
      text,
      timer: 1500,
      showConfirmButton: false,
    })
  }

  useEffect(() => {
    if (!isMenuOpen) {
      return undefined
    }

    function closeMenu(event) {
      if (!event.target.closest('.stok-menu')) {
        setIsMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', closeMenu)
    return () => document.removeEventListener('mousedown', closeMenu)
  }, [isMenuOpen])

  useEffect(() => {
    if (!isModalOutletOpen) {
      return undefined
    }

    let ignore = false

    async function loadOutlets() {
      setOutletLoading(true)
      try {
        const response = await api.get('/api/outlets')
        if (!ignore) {
          setDaftarOutlet(Array.isArray(response.data) ? response.data : [])
        }
      } catch {
        if (!ignore) {
          setDaftarOutlet([])
        }
      } finally {
        if (!ignore) {
          setOutletLoading(false)
        }
      }
    }

    loadOutlets()

    return () => {
      ignore = true
    }
  }, [isModalOutletOpen])

  useEffect(() => {
    if (!isOutletMenuOpen) {
      return undefined
    }

    function closeOutletMenu(event) {
      if (!event.target.closest('.outlet-menu')) {
        setIsOutletMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', closeOutletMenu)
    return () => document.removeEventListener('mousedown', closeOutletMenu)
  }, [isOutletMenuOpen])

  const currentItems = vouchers
  const page = currentPage
  const allSelected = currentItems.length > 0
    && currentItems.every((item) => selectedMap[item.username])
  const selectedVouchers = Object.keys(selectedMap)

  function toggleRow(item) {
    setSelectedMap((current) => {
      const next = { ...current }
      if (next[item.username]) {
        delete next[item.username]
      } else {
        next[item.username] = item
      }
      return next
    })
  }

  function toggleAll() {
    if (currentItems.length === 0) {
      return
    }
    setSelectedMap((current) => {
      const next = { ...current }
      if (currentItems.every((item) => next[item.username])) {
        currentItems.forEach((item) => delete next[item.username])
      } else {
        currentItems.forEach((item) => { next[item.username] = item })
      }
      return next
    })
  }

  function showUnderDevelopment() {
    Swal.fire(
      'Tahap Pengembangan',
      'Fitur ini masuk dalam antrean pembuatan dan belum bisa digunakan.',
      'warning',
    )
  }

  function handlePrintSelected() {
    setIsMenuOpen(false)
    const dataPrint = Object.values(selectedMap)
      .map((item) => {
        const profil = daftarProfil.find((profile) => profile.nama_profile === item.profile)
        return {
          ...item,
          masa_aktif: profil?.masa_aktif || '',
          masa_aktif_satuan: profil?.masa_aktif_satuan || '',
        }
      })

    if (dataPrint.length === 0) {
      Swal.fire({
        icon: 'warning',
        title: 'Pilih minimal satu voucher',
      })
      return
    }

    localStorage.setItem('print_vouchers', JSON.stringify(dataPrint))
    window.open('/print', '_blank')
  }

  async function handleDeleteSelected() {
    if (selectedVouchers.length === 0) {
      Swal.fire({
        icon: 'warning',
        title: 'Pilih minimal satu voucher',
      })
      return
    }

    const selectedRows = Object.values(selectedMap)
    const batchIds = new Set(selectedRows.map((item) => item.kode_batch ?? null))
    if (batchIds.size > 1) {
      Swal.fire(
        'Ditolak!',
        'Tidak bisa menghapus voucher dengan Kode Grup (Batch) yang berbeda. Harap pilih voucher dalam satu grup yang sama.',
        'error',
      )
      return
    }

    const result = await Swal.fire({
      title: 'Yakin ingin menghapus voucher ini?',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Ya, Hapus!',
      cancelButtonText: 'Batal',
    })
    if (!result.isConfirmed) {
      return
    }

    try {
      await api.post('/api/hotspot/voucher/delete-massal', {
        usernames: selectedVouchers,
      })
      setIsMenuOpen(false)
      setSelectedMap({})
      await fetchVouchers()
      notifySuccess('Data sukses diperbarui')
    } catch (requestError) {
      Swal.fire({
        icon: 'error',
        title: 'Gagal',
        text: requestError.response?.data?.message || 'Gagal menghapus voucher.',
      })
    }
  }

  async function handleGenerate(event) {
    event.preventDefault()

    if (generatingRef.current) {
      return
    }

    // Isian kosong atau tidak valid: tandai garis merah, tanpa request dan tanpa loading.
    setVoucherSubmitted(true)
    if (Object.values(voucherErrors).some(Boolean)) {
      return
    }

    const payload = {
      router: selectedRouter,
      server: selectedServer,
      jenis_voucher: jenisVoucher,
      kode_kombinasi: kodeKombinasi,
      prefix: prefix.trim(),
      outlet: selectedOutlet,
      mikrotik_group: mikrotikGroup,
      mitra: '',
      jumlah: Number(jumlah),
      panjang: Number(panjang),
    }

    generatingRef.current = true
    setSaving(true)
    setIsModalBuatVcOpen(false)

    Swal.fire({
      title: 'Sedang Memproses...',
      text: 'Mencetak ribuan voucher, harap tunggu.',
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      didOpen: () => {
        Swal.showLoading()
      },
    })

    try {
      await api.post('/api/hotspot/voucher/generate', payload)
    } catch (requestError) {
      Swal.close()
      Swal.fire(
        'Gagal!',
        requestError.response?.data?.message || 'Terjadi kesalahan saat generate voucher. Silakan coba lagi.',
        'error',
      )
      generatingRef.current = false
      setSaving(false)
      return
    }

    // Generate sukses: kosongkan form, lalu muat ulang tabel agar voucher baru tampil.
    resetVoucherForm()
    try {
      await fetchVouchers(1)
    } catch {
      setError('Voucher berhasil dibuat, tetapi tabel gagal dimuat ulang. Muat ulang halaman.')
    }

    Swal.close()
    Swal.fire('Berhasil!', 'Voucher sukses dibuat dan dimasukkan ke database.', 'success')
    generatingRef.current = false
    setSaving(false)
  }

  const selectedProfile = daftarProfil.find((item) => item.mikrotik_group === mikrotikGroup)
  // Pilihan server: ALL SERVER, lalu server Hotspot milik router terpilih
  // (ALL ROUTER atau router kosong menampilkan server semua router).
  const serverOptions = [
    ALL_SERVER,
    ...new Set(
      daftarServer
        .filter((item) => !selectedRouter || selectedRouter === 'ALL ROUTER' || item.nama_router === selectedRouter)
        .map((item) => item.nama),
    ),
  ]
  // true = field bermasalah. Dihitung ulang setiap render, jadi garis merah
  // hilang begitu isi field menjadi valid.
  const voucherErrors = {
    router: selectedRouter === ''
      || (selectedRouter !== 'ALL ROUTER' && !daftarRouter.some((item) => item.nama_router === selectedRouter)),
    server: !serverOptions.includes(selectedServer),
    jenis: !VOUCHER_JENIS.includes(jenisVoucher),
    kode: !VOUCHER_KODE.includes(kodeKombinasi),
    // Prefix opsional: kosong boleh, bila diisi harus 1-3 huruf atau angka.
    prefix: prefix.trim() !== '' && !/^[A-Za-z0-9]{1,3}$/.test(prefix.trim()),
    outlet: selectedOutlet === ''
      || !daftarOutletAktif.some((item) => item.nama_outlet === selectedOutlet),
    profile: !selectedProfile,
    jumlah: !/^\d+$/.test(String(jumlah).trim()) || Number(jumlah) < 1 || Number(jumlah) > 5000,
    panjang: !/^\d+$/.test(String(panjang).trim()) || Number(panjang) < 6 || Number(panjang) > 32,
  }
  function invalidProps(field) {
    const invalid = voucherSubmitted && voucherErrors[field]
    return {
      'aria-invalid': invalid ? 'true' : undefined,
      className: invalid ? 'border-red-500! focus:border-red-500! focus:ring-red-500/25!' : undefined,
    }
  }
  const hargaJual = Number(selectedProfile?.harga_jual) || 0
  const komisi = Number(selectedProfile?.komisi_reseller) || 0
  const hargaPokok = Number.isFinite(Number(selectedProfile?.hpp))
    ? Number(selectedProfile.hpp)
    : hargaJual - komisi
  const jumlahVoucher = Math.max(0, Number(jumlah) || 0)
  const totalStok = voucherSummary.total_stok
  const totalHpp = voucherSummary.total_hpp
  const totalKomisi = voucherSummary.total_komisi
  const totalHarga = voucherSummary.total_harga
  const summaries = summaryCards.map((card) => {
    if (card.key === 'stok') {
      return { ...card, value: totalStok.toLocaleString('id-ID') }
    }
    if (card.key === 'hpp') {
      return { ...card, value: formatRupiah(totalHpp) }
    }
    if (card.key === 'komisi') {
      return { ...card, value: formatRupiah(totalKomisi) }
    }
    return { ...card, value: formatRupiah(totalHarga) }
  })
  const searchOutletLower = searchOutlet.toLowerCase()
  const filteredOutlets = daftarOutlet.filter((item) => (
    (item.nama_outlet || '').toLowerCase().includes(searchOutletLower)
    || (item.pemilik || '').toLowerCase().includes(searchOutletLower)
    || (item.phone || '').toLowerCase().includes(searchOutletLower)
    || (item.alamat || '').toLowerCase().includes(searchOutletLower)
  ))
  const outletTotal = filteredOutlets.length
  const outletTotalPages = Math.max(1, Math.ceil(outletTotal / outletPerPage))
  const outletSafePage = Math.min(outletPage, outletTotalPages)
  const outletLastIndex = outletSafePage * outletPerPage
  const outletFirstIndex = outletLastIndex - outletPerPage
  const outletItems = filteredOutlets.slice(outletFirstIndex, outletLastIndex)
  const outletPageNumbers = Array.from({ length: outletTotalPages }, (_, index) => index + 1)
  const allOutletsSelected = outletItems.length > 0
    && outletItems.every((item) => selectedOutlets.includes(item.id))

  function toggleOutlet(id) {
    setSelectedOutlets((current) => (
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    ))
  }

  function toggleAllOutlets() {
    const visibleIds = outletItems.map((item) => item.id)
    if (visibleIds.length === 0) {
      return
    }
    if (visibleIds.every((id) => selectedOutlets.includes(id))) {
      setSelectedOutlets((current) => current.filter((id) => !visibleIds.includes(id)))
      return
    }
    setSelectedOutlets((current) => [...new Set([...current, ...visibleIds])])
  }

  // Kembalikan form Buat Voucher ke nilai awal (prefix dan outlet dikosongkan,
  // sisanya kembali ke pilihan bawaan).
  function resetVoucherForm() {
    setSelectedRouter('')
    setSelectedServer('')
    setJenisVoucher('')
    setKodeKombinasi('')
    setPrefix('')
    setSelectedOutlet('')
    setMikrotikGroup('')
    setJumlah(10)
    setPanjang(6)
    setVoucherSubmitted(false)
  }

  function closeVoucherModal() {
    if (saving) {
      return
    }
    setIsModalBuatVcOpen(false)
    resetVoucherForm()
  }

  function closeOutletModal() {
    setIsModalOutletOpen(false)
    setIsOutletMenuOpen(false)
    setIsModalTambahOutletOpen(false)
  }

  function openTambahOutlet() {
    setFormOutlet(emptyFormOutlet())
    setIsModalTambahOutletOpen(true)
  }

  function closeTambahOutlet() {
    setIsModalTambahOutletOpen(false)
    setFormOutlet(emptyFormOutlet())
  }

  function updateFormOutlet(event) {
    const { name, value } = event.target
    setFormOutlet((current) => ({ ...current, [name]: value }))
  }

  async function fetchOutlets() {
    const response = await api.get('/api/outlets')
    setDaftarOutlet(Array.isArray(response.data) ? response.data : [])
  }

  async function handleAksiOutletMassal(aksi) {
    if (selectedOutlets.length === 0) {
      Swal.fire({
        icon: 'warning',
        title: 'Pilih minimal satu outlet',
      })
      return
    }

    const isDelete = aksi === 'Hapus Terpilih'
    const status = aksi === 'Set Aktif' ? 'Aktif' : 'Tidak Aktif'
    const result = await Swal.fire({
      title: isDelete
        ? 'Yakin menghapus data outlet secara permanen?'
        : `Set outlet terpilih menjadi ${status}?`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: isDelete ? 'Ya, Hapus!' : 'Ya, Simpan!',
      cancelButtonText: 'Batal',
      confirmButtonColor: isDelete ? '#e11d48' : '#059669',
    })
    if (!result.isConfirmed) {
      return
    }

    try {
      if (isDelete) {
        await api.post('/api/outlets/delete-massal', {
          ids: selectedOutlets,
        })
      } else {
        await api.post('/api/outlets/set-status-massal', {
          ids: selectedOutlets,
          status,
        })
      }
      setIsOutletMenuOpen(false)
      setSelectedOutlets([])
      await fetchOutlets()
      notifySuccess(isDelete ? 'Outlet terpilih berhasil dihapus' : 'Status outlet berhasil diperbarui')
    } catch (requestError) {
      Swal.fire({
        icon: 'error',
        title: 'Gagal',
        text: requestError.response?.data?.message || 'Gagal memproses outlet terpilih.',
      })
    }
  }

  async function handleSaveOutlet(event) {
    event.preventDefault()
    if (!formOutlet.nama_outlet.trim()) {
      Swal.fire({
        icon: 'warning',
        title: 'Nama outlet wajib diisi',
      })
      return
    }

    Swal.fire({
      title: 'Menyimpan outlet...',
      text: 'Mohon tunggu sebentar.',
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      didOpen: () => {
        Swal.showLoading()
      },
    })

    try {
      await api.post('/api/outlets', {
        nama_outlet: formOutlet.nama_outlet.trim(),
        pemilik: formOutlet.pemilik.trim(),
        phone: formOutlet.phone.trim(),
        alamat: formOutlet.alamat.trim(),
        tgl_gabung: formOutlet.tgl_gabung,
      })
      setIsModalTambahOutletOpen(false)
      setFormOutlet(emptyFormOutlet())
      setOutletPage(1)
      await fetchOutlets()
      notifySuccess('Outlet berhasil disimpan')
    } catch (requestError) {
      Swal.fire({
        icon: 'error',
        title: 'Gagal',
        text: requestError.response?.data?.message || 'Gagal menyimpan outlet.',
      })
    }
  }
  return (
    <section className="grid w-full gap-4 text-left text-gray-900 transition-colors duration-300 dark:text-gray-100">
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        {summaries.map((item) => {
          const Icon = item.icon
          return (
            <article key={item.label} className="flex min-h-27 items-start justify-between gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm transition-colors duration-300 dark:border-gray-700 dark:bg-gray-800">
              <div>
                <p className="m-0 text-xs font-bold tracking-wider text-gray-500 uppercase dark:text-gray-400">{item.label}</p>
                <strong className="mt-2 block text-lg font-bold tracking-tight whitespace-nowrap text-gray-900 dark:text-gray-100">{item.value}</strong>
                <span className="mt-1.5 block text-xs font-semibold text-gray-400 dark:text-gray-500">{item.hint}</span>
              </div>
              <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${iconTone[item.tone] || iconTone.blue}`} aria-hidden="true">
                <Icon size={22} strokeWidth={2} />
              </span>
            </article>
          )
        })}
      </div>

      <div className="flex flex-wrap gap-2" role="toolbar" aria-label="Aksi stok voucher">
        <div className="stok-menu relative z-30">
          <button
            type="button"
            className={`${actionBtn} bg-blue-600 hover:bg-blue-500`}
            aria-expanded={isMenuOpen}
            aria-haspopup="menu"
            onClick={() => setIsMenuOpen((open) => !open)}
          >
            <Menu size={16} strokeWidth={2.2} />
            <span>MENU</span>
          </button>

          {isMenuOpen && (
            <div className="absolute top-full left-0 z-30 mt-2 grid min-w-48 gap-0.5 rounded-xl border border-gray-200 bg-white p-1.5 shadow-xl dark:border-gray-700 dark:bg-gray-800" role="menu">
              <button type="button" role="menuitem" className="flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-lg border-0 bg-transparent px-2.5 text-left text-[13px] font-bold text-gray-800 hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-gray-700" onClick={handlePrintSelected}>
                <Printer size={16} strokeWidth={2.2} />
                <span>Print Terpilih</span>
              </button>
              <button type="button" role="menuitem" className="flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-lg border-0 bg-transparent px-2.5 text-left text-[13px] font-bold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950" onClick={handleDeleteSelected}>
                <Trash size={16} strokeWidth={2.2} />
                <span>Hapus Terpilih</span>
              </button>
            </div>
          )}
        </div>

        {toolbar.map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.label}
              type="button"
              className={`${actionBtn} ${actionTone[item.tone] || actionTone.blue}`}
              onClick={
                item.label === 'BUAT VC'
                  ? () => setIsModalBuatVcOpen(true)
                  : item.label === 'OUTLET'
                    ? () => setIsModalOutletOpen(true)
                    : showUnderDevelopment
              }
            >
              <Icon size={16} strokeWidth={2.2} />
              <span>{item.label}</span>
            </button>
          )
        })}
      </div>

      <div className="flex flex-wrap gap-2.5 rounded-2xl border border-gray-200 bg-white p-3 shadow-sm transition-colors duration-300 dark:border-gray-700 dark:bg-gray-800">
        <label className="flex h-10 w-full items-center gap-2 rounded-lg border border-gray-300 bg-gray-50 px-2.5 text-gray-500 sm:w-42 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-300">
          <Calendar size={16} strokeWidth={2} />
          <input className="w-full min-w-0 border-0 bg-transparent text-[13px] font-semibold text-gray-900 outline-none dark:text-gray-100" type="date" name="tanggal" aria-label="Tanggal" />
        </label>

        <select className="h-10 min-w-36 flex-1 rounded-lg border border-gray-300 bg-gray-50 px-2.5 text-[13px] font-semibold text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100" name="profile" aria-label="All Profile" defaultValue="all">
          <option value="all">All Profile</option>
        </select>

        <select className="h-10 min-w-36 flex-1 rounded-lg border border-gray-300 bg-gray-50 px-2.5 text-[13px] font-semibold text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100" name="router" aria-label="All Router" defaultValue="all">
          <option value="all">All Router</option>
        </select>

        <select className="h-10 min-w-36 flex-1 rounded-lg border border-gray-300 bg-gray-50 px-2.5 text-[13px] font-semibold text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100" name="mitra" aria-label="Pilih Mitra" defaultValue="">
          <option value="">Pilih Mitra</option>
        </select>

        <select className="h-10 min-w-36 flex-1 rounded-lg border border-gray-300 bg-gray-50 px-2.5 text-[13px] font-semibold text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100" name="outlet" aria-label="Semua Outlet" defaultValue="all">
          <option value="all">Semua Outlet</option>
        </select>

        <select
          className="h-10 min-w-24 rounded-lg border border-gray-300 bg-gray-50 px-2.5 text-[13px] font-semibold text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
          name="limit"
          aria-label="Jumlah baris"
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

        <label className="flex h-10 min-w-56 flex-1 items-center gap-2 rounded-lg border border-gray-300 bg-gray-50 px-2.5 text-gray-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-300">
          <Search size={16} strokeWidth={2} />
          <input
            className="w-full min-w-0 border-0 bg-transparent text-[13px] font-semibold text-gray-900 outline-none placeholder:text-gray-400 dark:text-gray-100"
            type="search"
            name="q"
            placeholder="Cari voucher..."
            aria-label="Cari voucher"
            value={searchTerm}
            onChange={(event) => {
              setSearchTerm(event.target.value)
              setCurrentPage(1)
            }}
          />
        </label>
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm transition-colors duration-300 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-4 dark:border-gray-700">
          <div>
            <p className="m-0 mb-0.5 text-[11px] font-bold tracking-[0.12em] text-cyan-700 uppercase dark:text-cyan-300">Data Radius</p>
            <h1 className="m-0 text-xl font-bold tracking-tight text-gray-900 dark:text-gray-100">Daftar Voucher</h1>
          </div>
          <span className="text-[13px] font-bold text-gray-500 dark:text-gray-400">{loading ? 'Memuat...' : `${totalData.toLocaleString('id-ID')} voucher`}</span>
        </div>

        {loading && <p className="m-0 px-4 py-5 text-sm text-gray-500 dark:text-gray-400">Memuat data voucher...</p>}
        {error && <p className="m-0 px-4 py-5 text-sm font-semibold text-rose-700 dark:text-rose-300">{error}</p>}

        {!loading && !error && (
          <div className={fetching ? 'pointer-events-none overflow-x-auto opacity-55 transition-opacity' : 'overflow-x-auto transition-opacity'}>
            <table className="w-full min-w-[1480px] border-collapse">
              <thead>
                <tr>
                  <th className={`${thClass} w-12 pr-0`}>
                    <input
                      className="h-4 w-4 accent-cyan-700"
                      type="checkbox"
                      aria-label="Pilih semua voucher"
                      checked={allSelected}
                      onChange={toggleAll}
                    />
                  </th>
                  <th className={thClass}>KODE</th>
                  <th className={thClass}>USERNAME</th>
                  <th className={thClass}>PASSWORD</th>
                  <th className={thClass}>PROFILE</th>
                  <th className={thClass}>ROUTER</th>
                  <th className={thClass}>SERVER</th>
                  <th className={thClass}>MITRA</th>
                  <th className={thClass}>OUTLET</th>
                  <th className={thClass}>HPP</th>
                  <th className={thClass}>KOMISI</th>
                  <th className={thClass}>HARGA</th>
                  <th className={thClass}>SALDO/STATUS</th>
                  <th className={thClass}>ADMIN</th>
                  <th className={thClass}>TGL PEMBUATAN</th>
                </tr>
              </thead>
              <tbody>
                {currentItems.length === 0 ? (
                  <tr>
                    <td colSpan="15" className={`${tdClass} text-center text-gray-500 dark:text-gray-400`}>
                      {searchTerm ? 'Voucher tidak ditemukan.' : 'Belum ada voucher.'}
                    </td>
                  </tr>
                ) : (
                  currentItems.map((item) => (
                    <tr
                      key={item.id ?? item.username}
                      className={selectedMap[item.username] ? 'bg-sky-50 dark:bg-sky-950' : 'transition-colors duration-300 hover:bg-sky-50/80 dark:hover:bg-gray-900'}
                    >
                      <td className={`${tdClass} w-12 pr-0`}>
                        <input
                          className="h-4 w-4 accent-cyan-700"
                          type="checkbox"
                          aria-label={`Pilih ${item.username}`}
                          checked={Boolean(selectedMap[item.username])}
                          onChange={() => toggleRow(item)}
                        />
                      </td>
                      <td className={tdClass}>
                        <span className="font-mono text-[13px] font-bold tracking-wide">{item.kode_batch || '-'}</span>
                      </td>
                      <td className={tdClass}>{item.username}</td>
                      <td className={`${tdClass} group cursor-pointer`}>
                        <span className="group-hover:hidden">••••••••</span>
                        <span className="hidden group-hover:inline">{item.password}</span>
                      </td>
                      <td className={tdClass}>
                        <span className="inline-flex min-h-6.5 items-center rounded-full bg-sky-100 px-2.5 text-xs font-bold text-sky-900 dark:bg-sky-950 dark:text-sky-100">{item.profile || '-'}</span>
                      </td>
                      <td className={tdClass}>{item.router || '-'}</td>
                      <td className={tdClass}>{item.server || '-'}</td>
                      <td className={tdClass}>{item.mitra || '-'}</td>
                      <td className={tdClass}>{item.outlet || '-'}</td>
                      <td className={tdClass}>{formatRupiah(item.hpp)}</td>
                      <td className={tdClass}>{formatRupiah(item.komisi)}</td>
                      <td className={tdClass}>{formatRupiah(item.harga)}</td>
                      <td className={tdClass}>{item.status || '-'}</td>
                      <td className={tdClass}>{item.admin || '-'}</td>
                      <td className={tdClass}>{formatTanggal(item.created_at)}</td>
                    </tr>
                  ))
                )}
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
            label="Navigasi halaman"
            disabled={fetching}
          />
        )}
      </div>

      {isModalBuatVcOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 sm:p-6" onMouseDown={closeVoucherModal}>
          <div
            className={`${modalShell} max-w-5xl`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="stok-modal-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="px-6 pt-6">
              <h2 id="stok-modal-title" className="m-0 text-xl font-bold tracking-wide text-gray-900 dark:text-gray-100">Buat Voucher</h2>
              <p className="mt-1.5 mb-0 text-[13px] text-gray-500 dark:text-gray-400">Kode dibuat dari prefix (opsional) dan huruf serta angka acak.</p>
            </header>
            <form className="grid gap-4 px-6 pt-4 pb-6 [&_input]:box-border [&_input]:h-10 [&_input]:w-full [&_input]:rounded-lg [&_input]:border [&_input]:border-gray-300 [&_input]:bg-gray-50 [&_input]:px-3 [&_input]:text-sm [&_input]:font-medium [&_input]:text-gray-900 [&_input]:outline-none [&_input]:transition-colors [&_input]:duration-300 [&_input]:read-only:bg-gray-100 [&_input]:read-only:text-gray-500 [&_input]:focus:border-blue-800 [&_input]:focus:bg-white [&_input]:focus:ring-2 [&_input]:focus:ring-blue-800/20 dark:[&_input]:border-gray-600 dark:[&_input]:bg-gray-900 dark:[&_input]:text-gray-100 dark:[&_input]:focus:bg-gray-900 dark:[&_input]:read-only:bg-gray-950 [&_select]:box-border [&_select]:h-10 [&_select]:w-full [&_select]:rounded-lg [&_select]:border [&_select]:border-gray-300 [&_select]:bg-gray-50 [&_select]:px-3 [&_select]:text-sm [&_select]:font-medium [&_select]:text-gray-900 [&_select]:outline-none [&_select]:focus:border-blue-800 [&_select]:focus:bg-white [&_select]:focus:ring-2 [&_select]:focus:ring-blue-800/20 dark:[&_select]:border-gray-600 dark:[&_select]:bg-gray-900 dark:[&_select]:text-gray-100 dark:[&_select]:focus:bg-gray-900" onSubmit={handleGenerate} noValidate>
              <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-3">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:col-span-2">
                  <label className={fieldClass}>
                    <span>Router {requiredMark}</span>
                    <select
                      {...invalidProps('router')}
                      value={selectedRouter}
                      onChange={(event) => {
                        // Server milik router tertentu, jadi pilihan server dikosongkan saat router berganti.
                        setSelectedRouter(event.target.value)
                        setSelectedServer('')
                      }}
                    >
                      <option value="">-Pilih-</option>
                      <option value="ALL ROUTER">ALL ROUTER</option>
                      {daftarRouter.map((item) => (
                        <option key={item.id || item.nama_router} value={item.nama_router}>
                          {item.nama_router}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={fieldClass}>
                    <span>Server {requiredMark}</span>
                    <select {...invalidProps('server')} value={selectedServer} onChange={(event) => setSelectedServer(event.target.value)}>
                      <option value="">-Pilih-</option>
                      {serverOptions.map((name) => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                    </select>
                  </label>
                  <label className={fieldClass}>
                    <span>Jenis Voucher {requiredMark}</span>
                    <select {...invalidProps('jenis')} value={jenisVoucher} onChange={(event) => setJenisVoucher(event.target.value)}>
                      <option value="">-Pilih-</option>
                      <option value="username=password">username=password</option>
                      <option value="username+password">username+password</option>
                    </select>
                  </label>
                  <label className={fieldClass}>
                    <span>Kode Kombinasi {requiredMark}</span>
                    <select {...invalidProps('kode')} value={kodeKombinasi} onChange={(event) => setKodeKombinasi(event.target.value)}>
                      <option value="">-Pilih-</option>
                      <option value="huruf-kecil">Huruf Kecil</option>
                      <option value="huruf-besar">Huruf Besar</option>
                      <option value="huruf-campuran">Huruf Besar &amp; Kecil</option>
                      <option value="angka-huruf">Angka &amp; Huruf</option>
                    </select>
                  </label>
                  <label className={fieldClass}>
                    <span>Prefix</span>
                    <input
                      {...invalidProps('prefix')}
                      type="text"
                      maxLength="3"
                      placeholder="Opsional, 1-3 huruf atau angka"
                      value={prefix}
                      onChange={(event) => setPrefix(event.target.value)}
                    />
                  </label>
                  <label className={fieldClass}>
                    <span>Outlet {requiredMark}</span>
                    <select {...invalidProps('outlet')} value={selectedOutlet} onChange={(event) => setSelectedOutlet(event.target.value)}>
                      <option value="">-Pilih-</option>
                      {daftarOutletAktif.map((outlet) => (
                        <option key={outlet.id || outlet.nama_outlet} value={outlet.nama_outlet}>
                          {outlet.nama_outlet}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={fieldClass}>
                    <span>Profile {requiredMark}</span>
                    <select
                      {...invalidProps('profile')}
                      value={mikrotikGroup}
                      onChange={(event) => setMikrotikGroup(event.target.value)}
                    >
                      <option value="">-Pilih-</option>
                      {daftarProfil.map((item) => (
                        <option key={item.id || item.mikrotik_group} value={item.mikrotik_group}>
                          {item.nama_profile}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={fieldClass}>
                    <span>Jumlah {requiredMark}</span>
                    <input
                      {...invalidProps('jumlah')}
                      type="number"
                      min="1"
                      max="5000"
                      value={jumlah}
                      onChange={(event) => setJumlah(event.target.value)}
                    />
                  </label>
                  <label className={fieldClass}>
                    <span>Panjang Karakter {requiredMark}</span>
                    <input
                      {...invalidProps('panjang')}
                      type="number"
                      min="6"
                      max="32"
                      value={panjang}
                      onChange={(event) => setPanjang(event.target.value)}
                    />
                  </label>
                </div>

                <aside className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900" aria-label="Ringkasan harga">
                  <h3 className="m-0 text-[15px] font-bold text-gray-900 dark:text-gray-100">Ringkasan Harga</h3>
                  <p className="mt-1 mb-3 text-[13px] font-semibold text-gray-500 dark:text-gray-400">{selectedProfile?.nama_profile || 'Pilih profile'}</p>
                  <dl className="m-0 grid gap-2">
                    <div className="flex min-h-9 items-center justify-between gap-3 rounded-lg bg-white px-2.5 dark:bg-gray-800">
                      <dt className="text-xs font-bold text-gray-500 dark:text-gray-400">Harga Pokok</dt>
                      <dd className="m-0 text-[13px] font-bold whitespace-nowrap">{formatRupiah(hargaPokok)}</dd>
                    </div>
                    <div className="flex min-h-9 items-center justify-between gap-3 rounded-lg bg-white px-2.5 dark:bg-gray-800">
                      <dt className="text-xs font-bold text-gray-500 dark:text-gray-400">Harga Jual</dt>
                      <dd className="m-0 text-[13px] font-bold whitespace-nowrap">{formatRupiah(hargaJual)}</dd>
                    </div>
                    <div className="flex min-h-9 items-center justify-between gap-3 rounded-lg bg-white px-2.5 dark:bg-gray-800">
                      <dt className="text-xs font-bold text-gray-500 dark:text-gray-400">Komisi</dt>
                      <dd className="m-0 text-[13px] font-bold whitespace-nowrap">{formatRupiah(komisi)}</dd>
                    </div>
                    <div className="flex min-h-9 items-center justify-between gap-3 rounded-lg bg-white px-2.5 dark:bg-gray-800">
                      <dt className="text-xs font-bold text-gray-500 dark:text-gray-400">Total Komisi</dt>
                      <dd className="m-0 text-[13px] font-bold whitespace-nowrap">{formatRupiah(komisi * jumlahVoucher)}</dd>
                    </div>
                    <div className="flex min-h-9 items-center justify-between gap-3 rounded-lg bg-white px-2.5 dark:bg-gray-800">
                      <dt className="text-xs font-bold text-gray-500 dark:text-gray-400">Total Harga Pokok</dt>
                      <dd className="m-0 text-[13px] font-bold whitespace-nowrap">{formatRupiah(hargaPokok * jumlahVoucher)}</dd>
                    </div>
                  </dl>
                </aside>
              </div>
              <div className="flex justify-end gap-2.5">
                <button
                  type="button"
                  className={`${modalBtn} bg-slate-500 hover:bg-slate-600`}
                  onClick={closeVoucherModal}
                  disabled={saving}
                >
                  Batal
                </button>
                <button type="submit" className={`${modalBtn} bg-blue-900 hover:bg-blue-800`} disabled={saving}>
                  Generate
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isModalOutletOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 sm:p-6" onMouseDown={closeOutletModal}>
          <div
            className={`${modalShell} flex max-w-6xl flex-col p-4 sm:p-5`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="outlet-modal-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="flex items-start justify-between gap-3">
              <div>
                <p className="m-0 mb-1 text-xs font-bold tracking-[0.12em] text-cyan-700 uppercase dark:text-cyan-300">Hotspot</p>
                <h2 id="outlet-modal-title" className="m-0 text-[22px] font-bold tracking-tight">Data Outlet</h2>
              </div>
              <button type="button" className="grid h-8.5 w-8.5 cursor-pointer place-items-center rounded-lg border border-gray-200 bg-white text-gray-800 transition-colors duration-300 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-700" onClick={closeOutletModal} aria-label="Tutup">
                <X size={18} />
              </button>
            </header>

            <div className="mt-3.5 rounded-xl border border-emerald-300 bg-emerald-50 px-3.5 py-3 text-[13px] leading-snug font-semibold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
              Outlet adalah toko, warung atau individu yang menjual voucher langsung ke konsumen dan posisi outlet berada dibawah kontrol mitra reseller
            </div>

            <div className="mt-3.5 flex flex-wrap items-center gap-2">
              <div className="relative z-30">
                <button
                  type="button"
                  className={`${actionBtn} h-9 bg-emerald-600 hover:bg-emerald-500`}
                  aria-expanded={isOutletMenuOpen}
                  aria-haspopup="menu"
                  onClick={() => setIsOutletMenuOpen((open) => !open)}
                >
                  <Menu size={16} />
                  <span>MENU</span>
                </button>
                {isOutletMenuOpen && (
                  <div className="absolute top-full left-0 z-30 mt-2 grid min-w-48 gap-0.5 rounded-xl border border-gray-200 bg-white p-1.5 shadow-xl dark:border-gray-700 dark:bg-gray-800" role="menu">
                    <button type="button" role="menuitem" className="flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-lg border-0 bg-transparent px-2.5 text-left text-[13px] font-bold text-gray-800 hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-gray-700" onClick={() => handleAksiOutletMassal('Set Aktif')}>
                      <Check size={16} />
                      <span>Set Aktif</span>
                    </button>
                    <button type="button" role="menuitem" className="flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-lg border-0 bg-transparent px-2.5 text-left text-[13px] font-bold text-gray-800 hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-gray-700" onClick={() => handleAksiOutletMassal('Set Tidak Aktif')}>
                      <X size={16} />
                      <span>Set Tidak Aktif</span>
                    </button>
                    <button type="button" role="menuitem" className="flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-lg border-0 bg-transparent px-2.5 text-left text-[13px] font-bold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950" onClick={() => handleAksiOutletMassal('Hapus Terpilih')}>
                      <Trash size={16} />
                      <span>Hapus Terpilih</span>
                    </button>
                  </div>
                )}
              </div>
              <button type="button" className={`${actionBtn} h-9 bg-blue-600 hover:bg-blue-500`} onClick={openTambahOutlet}>
                <Plus size={16} />
                <span>TAMBAH</span>
              </button>
              <select
                className="h-9 rounded-lg border border-gray-300 bg-gray-50 px-2.5 text-[13px] font-bold text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                aria-label="Jumlah baris outlet"
                value={outletPerPage}
                onChange={(event) => {
                  setOutletPerPage(Number(event.target.value))
                  setOutletPage(1)
                }}
              >
                <option value="10">10</option>
                <option value="20">20</option>
              </select>
              <label className="ml-auto flex h-9 min-w-55 items-center gap-2 rounded-lg border border-gray-300 bg-gray-50 px-3 text-gray-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-300">
                <Search size={16} />
                <input
                  className="w-full min-w-0 border-0 bg-transparent text-[13px] text-gray-900 outline-none dark:text-gray-100"
                  type="search"
                  placeholder="Cari outlet..."
                  aria-label="Cari outlet"
                  value={searchOutlet}
                  onChange={(event) => {
                    setSearchOutlet(event.target.value)
                    setOutletPage(1)
                  }}
                />
              </label>
            </div>

            <div className="mt-3.5 overflow-auto">
              {outletLoading ? (
                <p className="px-3.5 py-5 text-sm text-gray-500">Memuat data outlet...</p>
              ) : (
                <table className="w-full min-w-[860px] border-collapse [&_td]:border-b [&_td]:border-gray-100 [&_td]:px-3.5 [&_td]:py-3 [&_td]:text-left [&_td]:text-sm [&_td]:whitespace-nowrap [&_td]:text-gray-800 dark:[&_td]:border-gray-700 dark:[&_td]:text-gray-100 [&_th]:bg-sky-900 [&_th]:px-3.5 [&_th]:py-3 [&_th]:text-left [&_th]:text-xs [&_th]:font-bold [&_th]:whitespace-nowrap [&_th]:text-sky-50">
                  <thead>
                    <tr>
                      <th className="w-12">
                        <input
                          className="h-4 w-4 accent-cyan-200"
                          type="checkbox"
                          aria-label="Pilih semua outlet"
                          checked={allOutletsSelected}
                          onChange={toggleAllOutlets}
                        />
                      </th>
                      <th>OUTLET</th>
                      <th>PEMILIK</th>
                      <th>PHONE</th>
                      <th>STOK VC</th>
                      <th>MITRA</th>
                      <th>STATUS</th>
                      <th>TGL GABUNG</th>
                      <th>ALAMAT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {outletItems.length === 0 ? (
                      <tr>
                        <td colSpan="9" className="text-center text-gray-500">
                          {searchOutlet ? 'Outlet tidak ditemukan.' : 'Belum ada outlet.'}
                        </td>
                      </tr>
                    ) : (
                      outletItems.map((item) => (
                        <tr key={item.id} className={selectedOutlets.includes(item.id) ? 'bg-sky-50 dark:bg-sky-950' : 'hover:bg-sky-50/70 dark:hover:bg-gray-900'}>
                          <td className="w-12">
                            <input
                              className="h-4 w-4 accent-cyan-700"
                              type="checkbox"
                              aria-label={`Pilih ${item.nama_outlet}`}
                              checked={selectedOutlets.includes(item.id)}
                              onChange={() => toggleOutlet(item.id)}
                            />
                          </td>
                          <td>{item.nama_outlet}</td>
                          <td>{item.pemilik || '-'}</td>
                          <td>{item.phone || '-'}</td>
                          <td className="font-extrabold text-rose-600">{item.stok_vc ?? 0}</td>
                          <td>{item.mitra || '-'}</td>
                          <td>
                            <span className={item.status === 'Tidak Aktif' ? 'inline-flex min-h-6.5 items-center rounded-full bg-rose-100 px-2.5 text-xs font-bold text-rose-800 dark:bg-rose-950 dark:text-rose-200' : 'inline-flex min-h-6.5 items-center rounded-full bg-emerald-100 px-2.5 text-xs font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'}>
                              {item.status || 'Aktif'}
                            </span>
                          </td>
                          <td>{item.tgl_gabung ? formatTanggalGabung(item.tgl_gabung) : formatTanggal(item.created_at)}</td>
                          <td>{item.alamat || '-'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              )}
            </div>

            <div className="mt-2 flex flex-col items-start justify-between gap-3 border-t border-gray-200 pt-3 sm:flex-row sm:items-center dark:border-gray-700">
              <p className="m-0 text-[13px] font-semibold text-gray-500 dark:text-gray-400">
                Showing {outletTotal === 0 ? 0 : outletFirstIndex + 1} to {Math.min(outletLastIndex, outletTotal)} of {outletTotal} entries
              </p>
              <nav className="ml-auto flex flex-wrap items-center gap-1.5" aria-label="Navigasi halaman outlet">
                <button
                  type="button"
                  className="inline-flex h-9 min-w-9 items-center justify-center rounded-lg border border-gray-300 bg-white px-3 text-[13px] font-bold text-gray-800 transition-colors duration-300 disabled:cursor-not-allowed disabled:text-gray-400 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                  disabled={outletSafePage <= 1}
                  onClick={() => setOutletPage(outletSafePage - 1)}
                >
                  Prev
                </button>
                {outletPageNumbers.map((pageNumber) => (
                  <button
                    key={pageNumber}
                    type="button"
                    className={pageNumber === outletSafePage ? 'inline-flex h-9 min-w-9 items-center justify-center rounded-lg border border-blue-600 bg-blue-600 px-3 text-[13px] font-bold text-white' : 'inline-flex h-9 min-w-9 items-center justify-center rounded-lg border border-gray-300 bg-white px-3 text-[13px] font-bold text-gray-800 transition-colors duration-300 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100'}
                    aria-current={pageNumber === outletSafePage ? 'page' : undefined}
                    onClick={() => setOutletPage(pageNumber)}
                  >
                    {pageNumber}
                  </button>
                ))}
                <button
                  type="button"
                  className="inline-flex h-9 min-w-9 items-center justify-center rounded-lg border border-gray-300 bg-white px-3 text-[13px] font-bold text-gray-800 transition-colors duration-300 disabled:cursor-not-allowed disabled:text-gray-400 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                  disabled={outletSafePage >= outletTotalPages}
                  onClick={() => setOutletPage(outletSafePage + 1)}
                >
                  Next
                </button>
              </nav>
            </div>
          </div>
        </div>
      )}

      {isModalTambahOutletOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/50 p-4 sm:p-6" onMouseDown={closeTambahOutlet}>
          <div
            className={`${modalShell} max-w-3xl p-6`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="tambah-outlet-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <h2 id="tambah-outlet-title" className="m-0 text-[22px] font-bold tracking-tight">OUTLET VOUCHER</h2>
            </header>
            <form className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 [&_input]:box-border [&_input]:h-10 [&_input]:w-full [&_input]:rounded-lg [&_input]:border [&_input]:border-gray-300 [&_input]:bg-gray-50 [&_input]:px-3 [&_input]:text-sm [&_input]:text-gray-900 [&_input]:outline-none [&_input]:focus:border-blue-800 [&_input]:focus:ring-2 [&_input]:focus:ring-blue-800/20 dark:[&_input]:border-gray-600 dark:[&_input]:bg-gray-900 dark:[&_input]:text-gray-100" onSubmit={handleSaveOutlet}>
              <label className={fieldClass}>
                <span>Outlet</span>
                <input
                  type="text"
                  name="nama_outlet"
                  value={formOutlet.nama_outlet}
                  onChange={updateFormOutlet}
                  maxLength={100}
                  required
                />
              </label>
              <label className={fieldClass}>
                <span>Pemilik</span>
                <input
                  type="text"
                  name="pemilik"
                  value={formOutlet.pemilik}
                  onChange={updateFormOutlet}
                  maxLength={100}
                />
              </label>
              <label className={fieldClass}>
                <span>Phone</span>
                <input
                  type="text"
                  name="phone"
                  value={formOutlet.phone}
                  onChange={updateFormOutlet}
                  maxLength={50}
                />
              </label>
              <label className={`${fieldClass} sm:col-span-2`}>
                <span>Alamat</span>
                <input
                  type="text"
                  name="alamat"
                  value={formOutlet.alamat}
                  onChange={updateFormOutlet}
                />
              </label>
              <label className={fieldClass}>
                <span>Tgl Gabung</span>
                <input
                  type="date"
                  name="tgl_gabung"
                  value={formOutlet.tgl_gabung}
                  onChange={updateFormOutlet}
                />
              </label>
              <div className="flex justify-end gap-2.5 sm:col-span-2">
                <button type="button" className={`${modalBtn} bg-slate-500 hover:bg-slate-600`} onClick={closeTambahOutlet}>
                  Close
                </button>
                <button type="submit" className={`${modalBtn} bg-blue-900 hover:bg-blue-800`}>
                  Simpan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  )
}

export default HotspotStok
