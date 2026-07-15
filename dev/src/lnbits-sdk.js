import {
  log,
  now,
  randomId,
  storageAppendPublic,
  storageDelete,
  storageGet,
  storageGetPaginated,
  storageGetPublic,
  storageGetPublicPaginated,
  storageSet,
  websocketPublish
} from 'lnbits:extension/host'

export const storage = {
  get(table, id, fallback = null) {
    const {dataJson} = storageGet({table, id})
    if (!dataJson) return fallback
    return JSON.parse(dataJson)
  },

  getPublic(table, id, fallback = null) {
    const {dataJson} = storageGetPublic({table, id})
    if (!dataJson) return fallback
    return JSON.parse(dataJson)
  },

  appendPublic(table, sourceId, data) {
    return storageAppendPublic({
      table,
      sourceId,
      dataJson: JSON.stringify(data || {})
    }).id
  },

  set(table, data) {
    storageSet({
      table,
      dataJson: JSON.stringify(data || {})
    })
    return data
  },

  getPaginated(table, options = {}) {
    return paginated(storageGetPaginated, table, options)
  },

  getPublicPaginated(table, options = {}) {
    return paginated(storageGetPublicPaginated, table, options)
  },

  delete(table, id) {
    storageDelete({table, id})
  }
}

export const websocket = {
  publish(itemId, data) {
    return websocketPublish({
      itemId,
      dataJson: JSON.stringify(data || {})
    }).sent
  }
}

export const system = {
  id(prefix) {
    return randomId({prefix}).id
  },

  now() {
    return Number(now().timestamp)
  },

  log(message, level = 'info') {
    log({level, message})
  }
}

function paginated(fn, table, options = {}) {
  const {rowsJson, total} = fn({
    table,
    filtersJson: JSON.stringify(options.filters || {}),
    search: options.search || '',
    searchFields: options.searchFields || [],
    sortBy: options.sortBy || '',
    descending: options.descending === true,
    limit: options.limit || 25,
    offset: options.offset || 0
  })
  return {
    data: JSON.parse(rowsJson || '[]'),
    total: Number(total || 0)
  }
}
