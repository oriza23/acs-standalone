import Swal from 'sweetalert2'

const SUCCESS_TIMER_MS = 1500

/** Sukses murni: tanpa tombol OK, tutup 1,5 detik, lalu refresh.
 *  Peringatan (icon selain success): tombol OK, tanpa timer, refresh setelah OK. */
export function fireSuccess(options = {}, refresh) {
  const sticky = options.icon != null && options.icon !== 'success'
  return Swal.fire({
    icon: 'success',
    showConfirmButton: false,
    timer: SUCCESS_TIMER_MS,
    ...options,
    ...(sticky ? { showConfirmButton: true, timer: undefined } : {}),
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
