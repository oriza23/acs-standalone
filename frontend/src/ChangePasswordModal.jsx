import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Eye, EyeOff, X } from 'lucide-react'
import Swal from 'sweetalert2'
import { fireSuccess } from './swals.js'
import api from './api/axios.js'

const MIN_PASSWORD = 6

function errorMessage(error, fallback) {
  return error?.response?.data?.message || fallback
}

function PasswordField({ label, name, value, onChange, autoComplete, autoFocus = false }) {
  const [visible, setVisible] = useState(false)

  return (
    <label className="grid gap-1.5 text-sm font-semibold text-gray-600 dark:text-gray-300">
      <span>{label}</span>
      <div className="flex h-11 items-center gap-2 rounded-xl border border-gray-300 bg-gray-50 px-3 text-gray-500 focus-within:border-cyan-600 focus-within:bg-white focus-within:ring-4 focus-within:ring-cyan-600/15 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-300 dark:focus-within:bg-gray-900">
        <input
          className="h-full w-full border-0 bg-transparent text-sm font-medium text-gray-900 outline-none dark:text-gray-100"
          type={visible ? 'text' : 'password'}
          name={name}
          autoComplete={autoComplete}
          value={value}
          onChange={onChange}
          autoFocus={autoFocus}
          required
          minLength={name === 'currentPassword' ? undefined : MIN_PASSWORD}
          maxLength={128}
        />
        <button
          type="button"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border-0 bg-transparent text-gray-500 hover:bg-gray-200 hover:text-gray-800 dark:hover:bg-gray-700 dark:hover:text-gray-100"
          aria-label={visible ? `Sembunyikan ${label}` : `Tampilkan ${label}`}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
    </label>
  )
}

function ChangePasswordModal({ onClose }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword
  const canSave = currentPassword.length > 0
    && newPassword.length >= MIN_PASSWORD
    && newPassword === confirmPassword
    && !submitting

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'Escape' && !submitting) {
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, submitting])

  async function handleSubmit(event) {
    event.preventDefault()
    if (!canSave) {
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const response = await api.post('/users/change-password', {
        currentPassword,
        newPassword,
        confirmPassword,
      })
      await fireSuccess({
        title: 'Password diubah',
        text: response.data?.message || 'Password berhasil diubah',
      }, () => { onClose() })
    } catch (requestError) {
      setError(errorMessage(requestError, 'Gagal mengubah password.'))
    } finally {
      setSubmitting(false)
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) {
          onClose()
        }
      }}
    >
      <form
        className="w-full max-w-md rounded-2xl bg-white shadow-xl dark:bg-gray-800"
        role="dialog"
        aria-modal="true"
        aria-labelledby="change-password-title"
        onSubmit={handleSubmit}
      >
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-6 py-4 dark:border-gray-700">
          <div>
            <h2 id="change-password-title" className="m-0 text-base font-bold text-gray-900 dark:text-gray-100">
              Ubah Password
            </h2>
            <p className="m-0 mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              Password baru minimal {MIN_PASSWORD} karakter dan harus sama dengan konfirmasi.
            </p>
          </div>
          <button
            type="button"
            className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-lg border-0 bg-transparent text-gray-500 hover:bg-gray-100 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-700"
            aria-label="Tutup"
            disabled={submitting}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        <div className="grid gap-4 px-6 py-5">
          {error && (
            <p className="m-0 rounded-xl bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800 dark:bg-rose-950 dark:text-rose-200" role="alert">
              {error}
            </p>
          )}
          <PasswordField
            label="Password Lama"
            name="currentPassword"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            autoFocus
          />
          <PasswordField
            label="Password Baru"
            name="newPassword"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
          <PasswordField
            label="Konfirmasi Password Baru"
            name="confirmPassword"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
          {mismatch && (
            <p className="m-0 text-sm font-semibold text-rose-600 dark:text-rose-400" role="status">
              Password baru dan konfirmasi harus sama.
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
          <button
            type="button"
            className="h-10 cursor-pointer rounded-xl border-0 bg-gray-200 px-4 text-sm font-bold text-gray-800 hover:bg-gray-300 disabled:opacity-60 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600"
            disabled={submitting}
            onClick={onClose}
          >
            Batal
          </button>
          <button
            type="submit"
            className="h-10 cursor-pointer rounded-xl border-0 bg-cyan-700 px-4 text-sm font-bold text-white hover:bg-cyan-600 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canSave}
          >
            {submitting ? 'Menyimpan...' : 'Simpan'}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}

export default ChangePasswordModal
