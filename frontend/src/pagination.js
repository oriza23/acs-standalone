// Daftar nomor halaman yang dirender: halaman pertama/terakhir, sekitar halaman
// aktif, dan '…' untuk lompatan. Menjaga jumlah tombol tetap kecil walau
// total halaman mencapai ratusan.
export function getPageWindow(page, totalPages, siblings = 1) {
  if (totalPages <= 5 + siblings * 2) {
    return Array.from({ length: totalPages }, (_, index) => index + 1)
  }

  const start = Math.max(2, page - siblings)
  const end = Math.min(totalPages - 1, page + siblings)
  const items = [1]

  if (start > 2) {
    items.push('start-gap')
  }
  for (let number = start; number <= end; number += 1) {
    items.push(number)
  }
  if (end < totalPages - 1) {
    items.push('end-gap')
  }
  items.push(totalPages)

  return items
}
