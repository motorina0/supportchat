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

const storage = {
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

const websocket = {
  publish(itemId, data) {
    return websocketPublish({
      itemId,
      dataJson: JSON.stringify(data || {})
    }).sent
  }
}

const system = {
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


const INBOXES_TABLE = 'inboxes'
const CONVERSATIONS_TABLE = 'conversations'
const MESSAGES_TABLE = 'messages'
const INBOX_SEARCH_FIELDS = ['name', 'welcome_message']
const CONVERSATION_SEARCH_FIELDS = [
  'visitor_name',
  'visitor_email',
  'subject',
  'status'
]
const MESSAGE_SEARCH_FIELDS = ['sender_name', 'body']

export function createInbox(requestJson) {
  return runJson(() => {
    const request = parseJsonObject(requestJson)
    const timestamp = system.now()
    const inbox = {
      id: cleanId(request.id) || system.id('inbox'),
      name: cleanText(request.name, 80) || 'Support inbox',
      welcome_message:
        cleanText(request.welcomeMessage ?? request.welcome_message, 280) ||
        'Send us a message and we will reply here.',
      is_active: request.isActive !== false && request.is_active !== false,
      created_at: timestamp,
      updated_at: timestamp
    }

    storage.set(INBOXES_TABLE, inbox)
    system.log(`supportchat: created inbox ${inbox.id}`)
    return {inbox: publicInbox(inbox)}
  })
}

export function updateInbox(requestJson) {
  return runJson(() => {
    const request = parseJsonObject(requestJson)
    const inboxId = requiredText(request.inboxId, 'inboxId', 128)
    const existing = getInbox(inboxId)
    const inbox = {
      ...existing,
      name: cleanText(request.name, 80) || existing.name,
      welcome_message:
        cleanText(request.welcomeMessage ?? request.welcome_message, 280) ||
        existing.welcome_message,
      is_active:
        request.isActive === undefined && request.is_active === undefined
          ? existing.is_active
          : request.isActive !== false && request.is_active !== false,
      updated_at: system.now()
    }

    storage.set(INBOXES_TABLE, inbox)
    system.log(`supportchat: updated inbox ${inbox.id}`)
    return {inbox: publicInbox(inbox)}
  })
}

export function listInboxes(requestJson) {
  return runJson(() => {
    const request = parseJsonObject(requestJson)
    const response = storage.getPaginated(INBOXES_TABLE, {
      search: cleanText(request.search, 256),
      searchFields: INBOX_SEARCH_FIELDS,
      sortBy: normalizeInboxSortBy(request.sortBy),
      descending: request.descending === true || request.descending === 'true',
      limit: normalizePageSize(request.rowsPerPage),
      offset: pageOffset(request)
    })

    return {
      inboxes: response.data.map(publicInbox),
      total: response.total
    }
  })
}

export function deleteInbox(requestJson) {
  return runJson(() => {
    const request = parseJsonObject(requestJson)
    const inboxId = requiredText(request.inboxId, 'inboxId', 128)
    const inbox = getInbox(inboxId)
    const conversations = storage.getPaginated(CONVERSATIONS_TABLE, {
      filters: {inbox_id: inboxId},
      limit: 1,
      offset: 0
    })

    if (conversations.total > 0) {
      throw new Error('Inboxes with conversations cannot be deleted.')
    }

    storage.delete(INBOXES_TABLE, inboxId)
    system.log(`supportchat: deleted inbox ${inboxId}`)
    return {id: inbox.id, deleted: true}
  })
}

export function listConversations(requestJson) {
  return runJson(() => {
    const request = parseJsonObject(requestJson)
    const inboxId = requiredText(request.inboxId, 'inboxId', 128)
    const inbox = getInbox(inboxId)
    const response = storage.getPaginated(CONVERSATIONS_TABLE, {
      filters: {inbox_id: inboxId},
      search: cleanText(request.search, 256),
      searchFields: CONVERSATION_SEARCH_FIELDS,
      sortBy: normalizeConversationSortBy(request.sortBy),
      descending: request.descending !== false && request.descending !== 'false',
      limit: normalizePageSize(request.rowsPerPage),
      offset: pageOffset(request)
    })

    return {
      inbox: publicInbox(inbox),
      conversations: response.data.map(privateConversation),
      total: response.total
    }
  })
}

export function listMessages(requestJson) {
  return runJson(() => {
    const request = parseJsonObject(requestJson)
    const conversationId = requiredText(
      request.conversationId,
      'conversationId',
      128
    )
    const conversation = getConversation(conversationId)
    const response = storage.getPaginated(MESSAGES_TABLE, {
      filters: {conversation_id: conversationId},
      search: cleanText(request.search, 256),
      searchFields: MESSAGE_SEARCH_FIELDS,
      sortBy: 'created_at',
      descending: false,
      limit: normalizePageSize(request.rowsPerPage, 200),
      offset: pageOffset(request, 200)
    })

    return {
      conversation: privateConversation(conversation),
      messages: response.data.map(publicMessage),
      total: response.total
    }
  })
}

export function replyConversation(requestJson) {
  return runJson(() => {
    const request = parseJsonObject(requestJson)
    const conversationId = requiredText(
      request.conversationId,
      'conversationId',
      128
    )
    const conversation = getConversation(conversationId)
    getInbox(conversation.inbox_id)
    const timestamp = system.now()
    const message = {
      id: system.id('msg'),
      conversation_id: conversationId,
      inbox_id: conversation.inbox_id,
      sender_type: 'agent',
      sender_name: cleanText(request.name, 80) || 'Support',
      body: requiredMessage(request.body ?? request.message),
      created_at: timestamp
    }
    storage.set(MESSAGES_TABLE, message)

    const updatedConversation = {
      ...conversation,
      status: 'open',
      updated_at: timestamp,
      last_message_at: timestamp
    }
    storage.set(CONVERSATIONS_TABLE, updatedConversation)

    publishMessage(updatedConversation, message)
    return {
      conversation: privateConversation(updatedConversation),
      message: publicMessage(message)
    }
  })
}

export function resolveConversation(requestJson) {
  return runJson(() => {
    const request = parseJsonObject(requestJson)
    const conversationId = requiredText(
      request.conversationId,
      'conversationId',
      128
    )
    const conversation = getConversation(conversationId)
    getInbox(conversation.inbox_id)
    const updatedConversation = {
      ...conversation,
      status: 'resolved',
      updated_at: system.now()
    }
    storage.set(CONVERSATIONS_TABLE, updatedConversation)
    publishConversation(updatedConversation, 'conversation.resolved')
    return {conversation: privateConversation(updatedConversation)}
  })
}

export function getPublicInbox(requestJson) {
  return runJson(() => {
    const request = parseJsonObject(requestJson)
    const inboxId = requiredText(request.inboxId, 'inboxId', 128)
    const inbox = getPublicInboxById(inboxId)
    return {inbox: publicInbox(inbox)}
  })
}

export function startConversation(requestJson) {
  return runJson(() => {
    const request = parseJsonObject(requestJson)
    const inboxId = requiredText(request.inboxId, 'inboxId', 128)
    const inbox = getPublicInboxById(inboxId)
    if (!inbox.is_active) {
      throw new Error('This support inbox is not accepting messages.')
    }

    const timestamp = system.now()
    const body = requiredMessage(request.body ?? request.message)
    const subject =
      cleanText(request.subject, 120) ||
      cleanText(body, 80) ||
      'New conversation'
    const conversationId = storage.appendPublic(CONVERSATIONS_TABLE, inboxId, {
      visitor_name: cleanText(request.name, 80) || 'Guest',
      visitor_email: cleanText(request.email, 160),
      subject,
      status: 'open',
      created_at: timestamp,
      updated_at: timestamp,
      last_message_at: timestamp
    })
    const conversation = getPublicConversationById(conversationId)
    const message = appendPublicMessage(conversation, {
      body,
      senderName: conversation.visitor_name || 'Guest',
      senderType: 'visitor',
      timestamp
    })

    publishMessage(conversation, message)
    return {
      inbox: publicInbox(inbox),
      conversation: publicConversation(conversation),
      messages: [publicMessage(message)]
    }
  })
}

export function getPublicConversation(requestJson) {
  return runJson(() => {
    const request = parseJsonObject(requestJson)
    const conversationId = requiredText(
      request.conversationId,
      'conversationId',
      128
    )
    const conversation = getPublicConversationById(conversationId)
    const inbox = getPublicInboxById(conversation.inbox_id)
    const messages = storage.getPublicPaginated(MESSAGES_TABLE, {
      filters: {conversation_id: conversationId},
      sortBy: 'created_at',
      descending: false,
      limit: normalizePageSize(request.rowsPerPage, 200),
      offset: pageOffset(request, 200)
    })

    return {
      inbox: publicInbox(inbox),
      conversation: publicConversation(conversation),
      messages: messages.data.map(publicMessage),
      total: messages.total
    }
  })
}

export function postPublicMessage(requestJson) {
  return runJson(() => {
    const request = parseJsonObject(requestJson)
    const conversationId = requiredText(
      request.conversationId,
      'conversationId',
      128
    )
    const conversation = getPublicConversationById(conversationId)
    if (conversation.status === 'resolved') {
      throw new Error('This conversation has been resolved.')
    }
    const message = appendPublicMessage(conversation, {
      body: requiredMessage(request.body ?? request.message),
      senderName:
        cleanText(request.name, 80) || conversation.visitor_name || 'Guest',
      senderType: 'visitor',
      timestamp: system.now()
    })

    publishMessage(conversation, message)
    return {
      conversation: publicConversation(conversation),
      message: publicMessage(message)
    }
  })
}

function appendPublicMessage(conversation, input) {
  const row = {
    inbox_id: conversation.inbox_id,
    sender_type: input.senderType,
    sender_name: input.senderName,
    body: input.body,
    created_at: input.timestamp
  }
  const id = storage.appendPublic(MESSAGES_TABLE, conversation.id, row)
  return {
    id,
    conversation_id: conversation.id,
    ...row
  }
}

function publishMessage(conversation, message) {
  const payload = {
    type: 'message.created',
    conversation: publicConversation(conversation),
    message: publicMessage(message)
  }
  websocket.publish(`conversation:${conversation.id}`, payload)
  websocket.publish(`inbox:${conversation.inbox_id}`, payload)
}

function publishConversation(conversation, type) {
  const payload = {
    type,
    conversation: publicConversation(conversation)
  }
  websocket.publish(`conversation:${conversation.id}`, payload)
  websocket.publish(`inbox:${conversation.inbox_id}`, payload)
}

function getInbox(inboxId) {
  const inbox = storage.get(INBOXES_TABLE, inboxId)
  if (!inbox) throw new Error('Support inbox not found.')
  return inbox
}

function getPublicInboxById(inboxId) {
  const inbox = storage.getPublic(INBOXES_TABLE, inboxId)
  if (!inbox) throw new Error('Support inbox not found.')
  return inbox
}

function getConversation(conversationId) {
  const conversation = storage.get(CONVERSATIONS_TABLE, conversationId)
  if (!conversation) throw new Error('Conversation not found.')
  return conversation
}

function getPublicConversationById(conversationId) {
  const conversation = storage.getPublic(CONVERSATIONS_TABLE, conversationId)
  if (!conversation) throw new Error('Conversation not found.')
  return conversation
}

function publicInbox(inbox) {
  return {
    id: inbox.id,
    name: inbox.name,
    welcomeMessage: inbox.welcome_message,
    isActive: inbox.is_active === true,
    createdAt: Number(inbox.created_at || 0),
    updatedAt: Number(inbox.updated_at || 0)
  }
}

function publicConversation(conversation) {
  return {
    id: conversation.id,
    inboxId: conversation.inbox_id,
    visitorName: conversation.visitor_name,
    subject: conversation.subject,
    status: normalizeStatus(conversation.status),
    createdAt: Number(conversation.created_at || 0),
    updatedAt: Number(conversation.updated_at || 0),
    lastMessageAt: Number(conversation.last_message_at || 0)
  }
}

function privateConversation(conversation) {
  return {
    ...publicConversation(conversation),
    visitorEmail: conversation.visitor_email
  }
}

function publicMessage(message) {
  return {
    id: message.id,
    conversationId: message.conversation_id,
    inboxId: message.inbox_id,
    senderType: message.sender_type,
    senderName: message.sender_name,
    body: message.body,
    createdAt: Number(message.created_at || 0)
  }
}

function runJson(fn) {
  try {
    return JSON.stringify({ok: true, data: fn()})
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    system.log(`supportchat: ${message}`, 'warning')
    return JSON.stringify({ok: false, error: message})
  }
}

function parseJsonObject(value) {
  if (!value) return {}
  const parsed = JSON.parse(value)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Expected a JSON object.')
  }
  return parsed
}

function requiredText(value, name, maxLength) {
  const text = cleanText(value, maxLength)
  if (!text) throw new Error(`${name} is required.`)
  return text
}

function requiredMessage(value) {
  const body = cleanMessage(value, 2000)
  if (!body) throw new Error('Message is required.')
  return body
}

function cleanId(value) {
  const text = cleanText(value, 128)
  return /^[A-Za-z0-9_-]{1,128}$/.test(text) ? text : ''
}

function cleanText(value, maxLength) {
  if (value === undefined || value === null) return ''
  return String(value).replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

function cleanMessage(value, maxLength) {
  if (value === undefined || value === null) return ''
  return String(value)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()
    .slice(0, maxLength)
}

function normalizeStatus(value) {
  return value === 'resolved' ? 'resolved' : 'open'
}

function normalizePageSize(value, fallback = 25) {
  const number = Number(value || fallback)
  if (!Number.isFinite(number) || number <= 0) return fallback
  return Math.max(1, Math.min(Math.trunc(number), 200))
}

function normalizePage(value) {
  const number = Number(value || 1)
  if (!Number.isFinite(number) || number <= 0) return 1
  return Math.trunc(number)
}

function pageOffset(request, fallback = 25) {
  return (
    (normalizePage(request.page) - 1) *
    normalizePageSize(request.rowsPerPage, fallback)
  )
}

function normalizeInboxSortBy(value) {
  return ['name', 'created_at', 'updated_at'].includes(value) ? value : 'created_at'
}

function normalizeConversationSortBy(value) {
  return ['created_at', 'updated_at', 'last_message_at', 'visitor_name'].includes(
    value
  )
    ? value
    : 'last_message_at'
}
