import { useEffect, useState } from 'react'
import './PrintVoucher.css'

const NETWORK_NAME = 'RANIAH HOTSPOT'

function readPrintVouchers() {
  try {
    const parsed = JSON.parse(localStorage.getItem('print_vouchers') || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function formatRupiah(value) {
  const number = Number(value) || 0
  return `Rp${number.toLocaleString('id-ID')}`
}

function formatMasaAktif(voucher) {
  if (!voucher.masa_aktif) {
    return voucher.profile || '-'
  }
  const satuan = voucher.masa_aktif_satuan ? ` ${voucher.masa_aktif_satuan}` : ''
  const profile = voucher.profile ? `${voucher.profile} · ` : ''
  return `${profile}${voucher.masa_aktif}${satuan}`
}

function PrintVoucher() {
  const [vouchers] = useState(readPrintVouchers)
  const [paperSize, setPaperSize] = useState('A4')

  useEffect(() => {
    document.body.classList.add('print-mode')
    document.getElementById('root')?.classList.add('print-mode')
    return () => {
      document.body.classList.remove('print-mode')
      document.getElementById('root')?.classList.remove('print-mode')
    }
  }, [])

  return (
    <main className="print-sheet">
      <style>{`@page { size: ${paperSize}; margin: 10mm; }`}</style>

      <header className="no-print print-toolbar">
        <h1>Pengaturan Cetak</h1>
        <div className="print-toolbar-actions">
          <select
            aria-label="Ukuran kertas"
            value={paperSize}
            onChange={(event) => setPaperSize(event.target.value)}
          >
            <option value="A4">A4</option>
            <option value="Legal">Legal</option>
            <option value="Letter">Letter</option>
            <option value="auto">auto (Universal)</option>
          </select>
          <button type="button" onClick={() => window.print()}>
            Print Sekarang
          </button>
        </div>
      </header>

      {vouchers.length === 0 ? (
        <p className="print-empty">Tidak ada voucher untuk dicetak. Pilih voucher dari stok, lalu gunakan Print Terpilih.</p>
      ) : (
        <section className="voucher-grid" aria-label="Kupon voucher">
          {vouchers.map((voucher, index) => (
            <article key={`${voucher.username}-${index}`} className="voucher-card">
              <header className="voucher-head">
                <div>
                  <p>Voucher Internet</p>
                  <h2>{NETWORK_NAME}</h2>
                </div>
                <strong>{formatRupiah(voucher.harga)}</strong>
              </header>
              <div className="voucher-cut" aria-hidden="true" />
              <div className="voucher-codes">
                <div>
                  <span>Username</span>
                  <b>{voucher.username || '-'}</b>
                </div>
                <div>
                  <span>Password</span>
                  <b>{voucher.password || '-'}</b>
                </div>
              </div>
              <footer>
                <span>Profil / Masa Aktif</span>
                <b>{formatMasaAktif(voucher)}</b>
              </footer>
            </article>
          ))}
        </section>
      )}
    </main>
  )
}

export default PrintVoucher
