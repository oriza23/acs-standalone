import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { User, X } from 'lucide-react'
import Swal from 'sweetalert2'
import { fireError, fireSuccess } from './swals.js'
import api from './api/axios.js'

function errorMessage(error, fallback) {
  return error?.response?.data?.message || fallback
}

function photoUrl(path) {
  if (!path) {
    return ''
  }
  if (/^https?:\/\//i.test(path)) {
    return path
  }
  const base = api.defaults.baseURL || ''
  return `${base.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(new Error('Gagal membaca file foto'))
    reader.readAsDataURL(file)
  })
}

export default function AdminProfileModal({ username, onClose, onSaved }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [profileUsername, setProfileUsername] = useState(username || '')
  const [email, setEmail] = useState('')
  const [fotoPath, setFotoPath] = useState('')
  const [previewUrl, setPreviewUrl] = useState('')
  const [photoDataUrl, setPhotoDataUrl] = useState('')

  const displayPhoto = previewUrl || photoUrl(fotoPath)

  useEffect(() => {
    let ignore = false

    async function loadProfile() {
      setLoading(true)
      try {
        const response = await api.get('/users/profile')
        if (ignore) {
          return
        }
        const data = response.data || {}
        setProfileUsername(data.username || username || '')
        setEmail(data.email || '')
        setFotoPath(data.foto_profil || '')
      } catch (error) {
        if (!ignore) {
          Swal.fire({ icon: 'error', title: 'Gagal', text: errorMessage(error, 'Profil gagal dimuat.') })
          onClose()
        }
      } finally {
        if (!ignore) {
          setLoading(false)
        }
      }
    }

    loadProfile()
    return () => {
      ignore = true
    }
  }, [username, onClose])

  useEffect(() => {
    return () => {
      if (previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrl)
      }
    }
  }, [previewUrl])

  const initials = useMemo(() => {
    const text = String(profileUsername || 'A').trim()
    return text.slice(0, 2).toUpperCase()
  }, [profileUsername])

  async function handlePhotoChange(event) {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }
    if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) {
      Swal.fire({ icon: 'warning', title: 'Format tidak didukung', text: 'Gunakan JPG, PNG, atau WebP (maks. 2 MB).' })
      event.target.value = ''
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      Swal.fire({ icon: 'warning', title: 'File terlalu besar', text: 'Ukuran foto maksimal 2 MB.' })
      event.target.value = ''
      return
    }
    try {
      const dataUrl = await readFileAsDataUrl(file)
      setPhotoDataUrl(dataUrl)
      setPreviewUrl(dataUrl)
    } catch (error) {
      Swal.fire({ icon: 'error', title: 'Gagal', text: error.message })
    }
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setSaving(true)
    try {
      const payload = { email: email.trim() }
      if (photoDataUrl) {
        payload.foto_profil_base64 = photoDataUrl
      }
      const response = await api.put('/users/profile', payload)
      await fireSuccess({
        title: 'Berhasil',
        text: response.data?.message || 'Profil berhasil disimpan',
      }, () => {
        onSaved?.(response.data?.profile)
        onClose()
      })
    } catch (error) {
      fireError({ title: 'Gagal', text: errorMessage(error, 'Profil gagal disimpan.') })
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-profile-title"
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl dark:bg-slate-900">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <p className="m-0 text-xs font-bold tracking-wider text-cyan-700 uppercase dark:text-cyan-400">Akun</p>
            <h2 id="admin-profile-title" className="m-0 text-xl font-bold text-slate-900 dark:text-gray-100">Profil Saya</h2>
          </div>
          <button
            type="button"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border-0 bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
            aria-label="Tutup"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Memuat profil...</p>
        ) : (
          <form className="grid gap-5" onSubmit={handleSubmit}>
            <div className="flex flex-col items-center gap-3">
              <div className="relative grid h-24 w-24 place-items-center overflow-hidden rounded-full border-2 border-cyan-100 bg-cyan-50 text-cyan-800 dark:border-cyan-900 dark:bg-cyan-950 dark:text-cyan-200">
                {displayPhoto ? (
                  <img src={displayPhoto} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-lg font-bold">{initials}</span>
                )}
                {!displayPhoto && <User className="absolute opacity-20" size={40} aria-hidden="true" />}
              </div>
              <label className="grid w-full max-w-xs gap-1.5 text-sm font-semibold text-gray-600 dark:text-gray-300">
                <span>Foto Profil</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-cyan-600 file:px-3 file:py-2 file:text-sm file:font-bold file:text-white hover:file:bg-cyan-700 dark:text-gray-300"
                  onChange={handlePhotoChange}
                />
              </label>
            </div>

            <label className="grid gap-1.5 text-sm font-semibold text-gray-600 dark:text-gray-300">
              <span>Nama / Username</span>
              <input
                type="text"
                value={profileUsername}
                disabled
                className="h-11 rounded-xl border border-gray-300 bg-gray-100 px-3 text-sm font-medium text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
              />
            </label>

            <label className="grid gap-1.5 text-sm font-semibold text-gray-600 dark:text-gray-300">
              <span>Alamat Email</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                autoComplete="email"
                placeholder="admin@contoh.com"
                className="h-11 rounded-xl border border-gray-300 bg-gray-50 px-3 text-sm font-medium text-gray-900 outline-none focus:border-cyan-600 focus:ring-4 focus:ring-cyan-600/15 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
              />
            </label>

            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <button
                type="button"
                className="h-11 rounded-xl border border-gray-300 bg-white px-4 text-sm font-bold text-gray-800 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                onClick={onClose}
                disabled={saving}
              >
                Batal
              </button>
              <button
                type="submit"
                className="h-11 rounded-xl border-0 bg-cyan-700 px-5 text-sm font-bold text-white hover:bg-cyan-800 disabled:opacity-70"
                disabled={saving}
              >
                {saving ? 'Menyimpan...' : 'Simpan Profil'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  )
}
