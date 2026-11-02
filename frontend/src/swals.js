import Swal from 'sweetalert2'

const SUCCESS_TIMER_MS = 1500

/** Alert sukses: tanpa tombol OK, tutup otomatis, lalu refresh (callback atau reload halaman). */
export function fireSuccess(options = {}, refresh) {
  return Swal.fire({
    icon: 'success',
    showConfirmButton: false,
    timer: SUCCESS_TIMER_MS,
    ...options,
  }).then(() => {
    if (typeof refresh === 'function') {
      refresh()
    } else if (refresh !== false) {
      window.location.reload()
    }
  })
}

/** Alert error: tombol OK wajib, tanpa timer — user harus membaca pesan. */
export function fireError(options = {}) {
  return Swal.fire({
    icon: 'error',
    showConfirmButton: true,
    ...options,
  })
}
