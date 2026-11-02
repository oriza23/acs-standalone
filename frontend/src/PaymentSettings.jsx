import { useEffect, useId, useState } from 'react'
import { CreditCard, QrCode, Save } from 'lucide-react'
import api from './api/axios.js'
import Swal from 'sweetalert2'
import { fireError, fireSuccess } from './swals.js'

const API = '/settings/payment'

const SETTING_CARD =
  'rounded-xl border border-gray-200 bg-white shadow-sm transition-shadow hover:shadow-md dark:border-slate-700 dark:bg-slate-900'

const inputClass =
  'h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-slate-800 outline-none transition-colors focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-950 dark:text-gray-100'

function qrisImageSrc(url) {
  if (!url) return ''
  if (/^https?:\/\//i.test(url)) return url
  const base = (api.defaults.baseURL || '').replace(/\/api\/?$/, '')
  return `${base}${url.startsWith('/') ? url : `/${url}`}`
}

function PaymentSettings() {
  const tripayId = useId()
  const qrisId = useId()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState('tripay')

  const [activeGateway, setActiveGateway] = useState('qris')
  const [merchantCode, setMerchantCode] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [privateKey, setPrivateKey] = useState('')
  const [environment, setEnvironment] = useState('sandbox')
  const [apiKeyHint, setApiKeyHint] = useState('')
  const [privateKeyHint, setPrivateKeyHint] = useState('')

  const [qrisString, setQrisString] = useState('')
  const [qrisFee, setQrisFee] = useState('')
  const [qrisImageUrl, setQrisImageUrl] = useState('')
  const [qrisFile, setQrisFile] = useState(null)
  const [qrisPreview, setQrisPreview] = useState('')

  useEffect(() => {
    let ignore = false

    async function load() {
      setLoading(true)
      try {
        const { data } = await api.get(API, { params: { include_secrets: 1 } })
        if (ignore) return
        setActiveGateway(data.active_gateway === 'tripay' ? 'tripay' : 'qris')
        setMerchantCode(data.tripay?.merchant_code || '')
        setEnvironment(data.tripay?.environment === 'production' ? 'production' : 'sandbox')
        setApiKey(data.tripay?.api_key || '')
        setPrivateKey(data.tripay?.private_key || '')
        setApiKeyHint(data.tripay?.api_key_preview || '')
        setPrivateKeyHint(data.tripay?.private_key_preview || '')
        setQrisString(data.qris?.qris_string || '')
        setQrisFee(
          data.qris?.qris_fee_nontunai != null && data.qris?.qris_fee_nontunai !== ''
            ? String(data.qris.qris_fee_nontunai)
            : '',
        )
        setQrisImageUrl(data.qris?.qris_image_url || '')
      } catch {
        if (!ignore) {
          Swal.fire('Gagal', 'Pengaturan pembayaran gagal dimuat.', 'error')
        }
      } finally {
        if (!ignore) setLoading(false)
      }
    }

    load()
    return () => { ignore = true }
  }, [])

  useEffect(() => {
    if (!qrisFile) {
      setQrisPreview('')
      return undefined
    }
    const objectUrl = URL.createObjectURL(qrisFile)
    setQrisPreview(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [qrisFile])

  async function handleSave(event) {
    event.preventDefault()
    setSaving(true)
    try {
      const form = new FormData()
      form.append('active_gateway', activeGateway)
      form.append('tripay_merchant_code', merchantCode.trim())
      form.append('tripay_environment', environment)
      if (apiKey.trim()) form.append('tripay_api_key', apiKey.trim())
      if (privateKey.trim()) form.append('tripay_private_key', privateKey.trim())
      form.append('qris_string', qrisString.trim())
      if (qrisFee.trim() !== '') form.append('qris_fee_nontunai', qrisFee.trim())
      if (qrisFile) form.append('qris_image', qrisFile)

      const { data } = await api.post(API, form)
      setActiveGateway(data.active_gateway === 'tripay' ? 'tripay' : 'qris')
      setMerchantCode(data.tripay?.merchant_code || '')
      setEnvironment(data.tripay?.environment === 'production' ? 'production' : 'sandbox')
      setApiKeyHint(data.tripay?.api_key_preview || '')
      setPrivateKeyHint(data.tripay?.private_key_preview || '')
      setQrisImageUrl(data.qris?.qris_image_url || '')
      setQrisFile(null)
      await fireSuccess({ title: 'Berhasil', text: data.message || 'Pengaturan pembayaran disimpan.' }, false)
    } catch (requestError) {
      fireError({ title: 'Gagal', text: requestError.response?.data?.message || 'Pengaturan gagal disimpan.' })
    } finally {
      setSaving(false)
    }
  }

  const displayImage = qrisPreview || qrisImageSrc(qrisImageUrl)

  return (
    <section className="mx-auto max-w-3xl pb-8">
      <header className="mb-6">
        <p className="m-0 text-xs font-bold tracking-widest text-cyan-700 uppercase dark:text-cyan-400">Sistem</p>
        <h1 className="m-0 text-3xl font-bold tracking-tight text-slate-900 dark:text-gray-100">Pengaturan Payment</h1>
        <p className="mt-2 mb-0 text-sm text-slate-600 dark:text-gray-400">
          Atur Tripay atau QRIS manual untuk pembayaran tagihan pelanggan.
        </p>
      </header>

      <form onSubmit={handleSave} className={`${SETTING_CARD} overflow-hidden`}>
        <div className="border-b border-gray-200 p-6 dark:border-slate-700">
          <h2 className="m-0 text-sm font-bold text-slate-800 dark:text-gray-100">Mode pembayaran aktif</h2>
          <p className="mt-1 mb-4 text-xs text-slate-500 dark:text-gray-400">
            Hanya satu gateway yang dipakai saat pelanggan membayar.
          </p>
          <fieldset className="m-0 flex flex-col gap-3 border-0 p-0 sm:flex-row sm:gap-6" disabled={loading || saving}>
            <label className="inline-flex cursor-pointer items-center gap-2.5 rounded-xl border border-gray-200 px-4 py-3 has-checked:border-cyan-500 has-checked:bg-cyan-50/80 dark:border-slate-600 dark:has-checked:border-cyan-500 dark:has-checked:bg-cyan-950/30">
              <input
                type="radio"
                name="active_gateway"
                value="tripay"
                checked={activeGateway === 'tripay'}
                onChange={() => setActiveGateway('tripay')}
                className="h-4 w-4 accent-cyan-600"
              />
              <CreditCard size={18} className="text-cyan-700 dark:text-cyan-400" aria-hidden="true" />
              <span className="text-sm font-semibold text-slate-800 dark:text-gray-100">Tripay</span>
            </label>
            <label className="inline-flex cursor-pointer items-center gap-2.5 rounded-xl border border-gray-200 px-4 py-3 has-checked:border-cyan-500 has-checked:bg-cyan-50/80 dark:border-slate-600 dark:has-checked:border-cyan-500 dark:has-checked:bg-cyan-950/30">
              <input
                type="radio"
                name="active_gateway"
                value="qris"
                checked={activeGateway === 'qris'}
                onChange={() => setActiveGateway('qris')}
                className="h-4 w-4 accent-cyan-600"
              />
              <QrCode size={18} className="text-cyan-700 dark:text-cyan-400" aria-hidden="true" />
              <span className="text-sm font-semibold text-slate-800 dark:text-gray-100">QRIS Manual</span>
            </label>
          </fieldset>
        </div>

        <div className="flex border-b border-gray-200 dark:border-slate-700" role="tablist" aria-label="Konfigurasi gateway">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'tripay'}
            className={`flex flex-1 items-center justify-center gap-2 border-0 px-4 py-3.5 text-sm font-bold transition-colors ${
              activeTab === 'tripay'
                ? 'border-b-2 border-cyan-600 bg-cyan-50/50 text-cyan-800 dark:bg-cyan-950/20 dark:text-cyan-300'
                : 'bg-transparent text-slate-500 hover:bg-slate-50 dark:text-gray-400 dark:hover:bg-slate-800/50'
            }`}
            onClick={() => setActiveTab('tripay')}
          >
            <CreditCard size={16} aria-hidden="true" />
            Tripay
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'qris'}
            className={`flex flex-1 items-center justify-center gap-2 border-0 px-4 py-3.5 text-sm font-bold transition-colors ${
              activeTab === 'qris'
                ? 'border-b-2 border-cyan-600 bg-cyan-50/50 text-cyan-800 dark:bg-cyan-950/20 dark:text-cyan-300'
                : 'bg-transparent text-slate-500 hover:bg-slate-50 dark:text-gray-400 dark:hover:bg-slate-800/50'
            }`}
            onClick={() => setActiveTab('qris')}
          >
            <QrCode size={16} aria-hidden="true" />
            QRIS Manual
          </button>
        </div>

        <div className="p-6">
          {activeTab === 'tripay' && (
            <div role="tabpanel" className="grid gap-4">
              <label className="grid gap-2" htmlFor={`${tripayId}-merchant`}>
                <span className="text-xs font-bold text-slate-600 dark:text-gray-400">Merchant Code</span>
                <input
                  id={`${tripayId}-merchant`}
                  type="text"
                  value={merchantCode}
                  onChange={(e) => setMerchantCode(e.target.value)}
                  disabled={loading || saving}
                  className={inputClass}
                  autoComplete="off"
                />
              </label>
              <label className="grid gap-2" htmlFor={`${tripayId}-api-key`}>
                <span className="text-xs font-bold text-slate-600 dark:text-gray-400">API Key</span>
                <input
                  id={`${tripayId}-api-key`}
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  disabled={loading || saving}
                  className={inputClass}
                  placeholder={apiKeyHint ? `Tersimpan ${apiKeyHint} — kosongkan jika tidak diubah` : ''}
                  autoComplete="off"
                />
              </label>
              <label className="grid gap-2" htmlFor={`${tripayId}-private-key`}>
                <span className="text-xs font-bold text-slate-600 dark:text-gray-400">Private Key</span>
                <input
                  id={`${tripayId}-private-key`}
                  type="password"
                  value={privateKey}
                  onChange={(e) => setPrivateKey(e.target.value)}
                  disabled={loading || saving}
                  className={inputClass}
                  placeholder={privateKeyHint ? `Tersimpan ${privateKeyHint} — kosongkan jika tidak diubah` : ''}
                  autoComplete="off"
                />
              </label>
              <label className="grid gap-2" htmlFor={`${tripayId}-env`}>
                <span className="text-xs font-bold text-slate-600 dark:text-gray-400">Environment</span>
                <select
                  id={`${tripayId}-env`}
                  value={environment}
                  onChange={(e) => setEnvironment(e.target.value)}
                  disabled={loading || saving}
                  className={inputClass}
                >
                  <option value="sandbox">Sandbox</option>
                  <option value="production">Production</option>
                </select>
              </label>
            </div>
          )}

          {activeTab === 'qris' && (
            <div role="tabpanel" className="grid gap-4">
              <label className="grid gap-2" htmlFor={`${qrisId}-file`}>
                <span className="text-xs font-bold text-slate-600 dark:text-gray-400">Gambar QRIS statis</span>
                <input
                  id={`${qrisId}-file`}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={loading || saving}
                  onChange={(e) => setQrisFile(e.target.files?.[0] || null)}
                  className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-cyan-600 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-cyan-700 dark:text-gray-300"
                />
                <span className="text-xs text-slate-500 dark:text-gray-500">JPEG, PNG, atau WebP — maks. 2 MB</span>
              </label>
              {displayImage && (
                <div className="flex justify-center rounded-xl border border-dashed border-gray-300 bg-slate-50 p-4 dark:border-slate-600 dark:bg-slate-950/50">
                  <img src={displayImage} alt="Pratinjau QRIS" className="max-h-48 max-w-full rounded-lg object-contain" />
                </div>
              )}
              <label className="grid gap-2" htmlFor={`${qrisId}-string`}>
                <span className="text-xs font-bold text-slate-600 dark:text-gray-400">String QRIS asli (EMVCo)</span>
                <textarea
                  id={`${qrisId}-string`}
                  value={qrisString}
                  onChange={(e) => setQrisString(e.target.value)}
                  disabled={loading || saving}
                  rows={6}
                  spellCheck={false}
                  className={`${inputClass} h-auto min-h-[8rem] resize-y py-3 font-mono text-xs leading-relaxed`}
                  placeholder="0002010102115204000053033605802ID..."
                />
              </label>
              <label className="grid gap-2" htmlFor={`${qrisId}-fee`}>
                <span className="text-xs font-bold text-slate-600 dark:text-gray-400">
                  Biaya nontunai (opsional, Rp)
                </span>
                <input
                  id={`${qrisId}-fee`}
                  type="number"
                  min="0"
                  step="1"
                  value={qrisFee}
                  onChange={(e) => setQrisFee(e.target.value)}
                  disabled={loading || saving}
                  className={inputClass}
                  placeholder="0"
                />
              </label>
            </div>
          )}

          <div className="mt-8 flex justify-end border-t border-gray-100 pt-6 dark:border-slate-800">
            <button
              type="submit"
              disabled={loading || saving}
              className="inline-flex h-11 min-w-[11rem] items-center justify-center gap-2 rounded-lg bg-cyan-600 px-5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-cyan-700 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Save size={16} strokeWidth={2.25} aria-hidden="true" />
              {saving ? 'Menyimpan…' : 'Simpan Pengaturan'}
            </button>
          </div>
        </div>
      </form>
    </section>
  )
}

export default PaymentSettings
