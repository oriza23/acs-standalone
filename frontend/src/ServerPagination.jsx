import { getPageWindow } from './pagination.js'

const pageBtn =
  'inline-flex h-9 min-w-9 items-center justify-center rounded-lg border px-3 text-[13px] font-bold transition-colors duration-300 disabled:cursor-not-allowed'

function ServerPagination({ page, totalPages, totalData, limit, onPageChange, label = 'Navigasi halaman', disabled = false }) {
  const firstIndex = (page - 1) * limit
  const showingStart = totalData === 0 ? 0 : firstIndex + 1
  const showingEnd = Math.min(firstIndex + limit, totalData)

  return (
    <div className="flex flex-col items-start justify-between gap-4 border-t border-gray-200 bg-white px-4 py-3.5 transition-colors duration-300 sm:flex-row sm:items-center dark:border-gray-700 dark:bg-gray-800">
      <p className="m-0 text-[13px] font-semibold text-gray-500 dark:text-gray-400">
        Showing {showingStart.toLocaleString('id-ID')} to {showingEnd.toLocaleString('id-ID')} of {totalData.toLocaleString('id-ID')} entries
      </p>
      <nav className="ml-auto flex flex-wrap items-center justify-end gap-1.5" aria-label={label}>
        <button
          type="button"
          className={`${pageBtn} border-gray-300 bg-white text-gray-800 hover:border-blue-600 hover:bg-blue-50 hover:text-blue-600 disabled:bg-gray-50 disabled:text-gray-400 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700 dark:disabled:bg-gray-900 dark:disabled:text-gray-500`}
          disabled={disabled || page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Previous
        </button>
        {getPageWindow(page, totalPages).map((item) => (
          typeof item === 'number' ? (
            <button
              key={item}
              type="button"
              className={
                item === page
                  ? `${pageBtn} border-blue-600 bg-blue-600 text-white`
                  : `${pageBtn} border-gray-300 bg-white text-gray-800 hover:border-blue-600 hover:bg-blue-50 hover:text-blue-600 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700`
              }
              aria-current={item === page ? 'page' : undefined}
              disabled={disabled}
              onClick={() => onPageChange(item)}
            >
              {item}
            </button>
          ) : (
            <span key={item} className="inline-flex min-w-6 items-center justify-center font-bold text-gray-400" aria-hidden="true">…</span>
          )
        ))}
        <button
          type="button"
          className={`${pageBtn} border-gray-300 bg-white text-gray-800 hover:border-blue-600 hover:bg-blue-50 hover:text-blue-600 disabled:bg-gray-50 disabled:text-gray-400 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700 dark:disabled:bg-gray-900 dark:disabled:text-gray-500`}
          disabled={disabled || page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </button>
      </nav>
    </div>
  )
}

export default ServerPagination
