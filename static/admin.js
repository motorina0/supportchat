const client = window.createLNbitsSupportChatClient({
  extensionId: 'supportchat'
})

const state = {
  conversations: [],
  conversationSearch: '',
  error: '',
  form: emptyForm(),
  inboxes: [],
  loading: '',
  messages: [],
  selectedConversation: null,
  selectedInbox: null,
  unsubscribeConversation: null,
  unsubscribeInbox: null
}

const root = document.getElementById('supportchat-admin-app')

init()

async function init() {
  render()
  await fetchInboxes()
}

function emptyForm() {
  return {
    id: '',
    name: 'Support',
    welcomeMessage: 'Send us a message and we will reply here.',
    isActive: true
  }
}

async function fetchInboxes() {
  await withError(async () => {
    state.loading = 'inboxes'
    render()
    const response = await client.listInboxes({
      rowsPerPage: 100,
      sortBy: 'created_at',
      descending: true
    })
    state.inboxes = response.inboxes || []
    if (!state.selectedInbox && state.inboxes.length) {
      await selectInbox(state.inboxes[0].id, {skipRender: true})
    } else if (state.selectedInbox) {
      state.selectedInbox =
        state.inboxes.find(inbox => inbox.id === state.selectedInbox.id) || null
    }
  }, 'Could not load inboxes.')
  state.loading = ''
  render()
}

async function saveInbox() {
  const container = byId('inbox-form')
  await withError(async () => {
    state.loading = 'saving'
    render()
    const payload = {
      name: fieldValue(container, 'name'),
      welcomeMessage: fieldValue(container, 'welcomeMessage'),
      isActive: Boolean(container?.querySelector('[name="isActive"]')?.checked)
    }
    const response = state.form.id
      ? await client.updateInbox(state.form.id, payload)
      : await client.createInbox(payload)
    state.form = emptyForm()
    await fetchInboxes()
    if (response.inbox) await selectInbox(response.inbox.id)
  }, 'Could not save inbox.')
  state.loading = ''
  render()
}

async function deleteSelectedInbox() {
  if (!state.selectedInbox) return
  if (!window.confirm('Delete this inbox?')) return
  await withError(async () => {
    state.loading = 'deleting'
    render()
    await client.deleteInbox(state.selectedInbox.id)
    state.selectedInbox = null
    state.selectedConversation = null
    state.messages = []
    await fetchInboxes()
  }, 'Could not delete inbox.')
  state.loading = ''
  render()
}

async function selectInbox(inboxId, options = {}) {
  const inbox = state.inboxes.find(item => item.id === inboxId) || null
  if (!inbox) return
  state.selectedInbox = inbox
  state.selectedConversation = null
  state.messages = []
  if (!options.skipRender) render()
  await subscribeInbox(inbox.id)
  await fetchConversations()
}

async function fetchConversations() {
  if (!state.selectedInbox) return
  const searchInput = byId('conversation-search')
  if (searchInput) state.conversationSearch = searchInput.value || ''
  await withError(async () => {
    state.loading = 'conversations'
    render()
    const response = await client.listConversations(state.selectedInbox.id, {
      rowsPerPage: 100,
      search: state.conversationSearch,
      sortBy: 'last_message_at',
      descending: true
    })
    state.conversations = response.conversations || []
    if (state.selectedConversation) {
      state.selectedConversation =
        state.conversations.find(
          conversation => conversation.id === state.selectedConversation.id
        ) || state.selectedConversation
    }
  }, 'Could not load conversations.')
  state.loading = ''
  render()
}

async function selectConversation(conversationId) {
  const conversation =
    state.conversations.find(item => item.id === conversationId) || null
  if (!conversation) return
  state.selectedConversation = conversation
  render()
  await subscribeConversation(conversation.id)
  await fetchMessages()
}

async function fetchMessages() {
  if (!state.selectedConversation) return
  await withError(async () => {
    state.loading = 'messages'
    render()
    const response = await client.listMessages(state.selectedConversation.id, {
      rowsPerPage: 200
    })
    state.messages = response.messages || []
  }, 'Could not load messages.')
  state.loading = ''
  render()
  scrollThreadToBottom()
}

async function replyToConversation() {
  if (!state.selectedConversation) return
  const body = fieldValue(byId('reply-box'), 'body').trim()
  if (!body) return
  await withError(async () => {
    state.loading = 'replying'
    render()
    const response = await client.replyConversation(
      state.selectedConversation.id,
      {body}
    )
    state.selectedConversation =
      response.conversation || state.selectedConversation
    addMessage(response.message)
    await fetchConversations()
  }, 'Could not send reply.')
  state.loading = ''
  render()
  scrollThreadToBottom()
}

async function resolveSelectedConversation() {
  if (!state.selectedConversation) return
  await withError(async () => {
    state.loading = 'resolving'
    render()
    const response = await client.resolveConversation(
      state.selectedConversation.id
    )
    state.selectedConversation =
      response.conversation || state.selectedConversation
    await fetchConversations()
  }, 'Could not resolve conversation.')
  state.loading = ''
  render()
}

async function subscribeInbox(inboxId) {
  if (state.unsubscribeInbox) state.unsubscribeInbox()
  state.unsubscribeInbox = await client.subscribeWebsocket(
    `inbox:${inboxId}`,
    event => {
      if (event.event === 'websocket.message') fetchConversations()
    }
  )
}

async function subscribeConversation(conversationId) {
  if (state.unsubscribeConversation) state.unsubscribeConversation()
  state.unsubscribeConversation = await client.subscribeWebsocket(
    `conversation:${conversationId}`,
    event => {
      if (event.event !== 'websocket.message') return
      const data = event.data || {}
      if (data.message) addMessage(data.message)
      if (data.conversation) state.selectedConversation = data.conversation
      fetchConversations()
      render()
      scrollThreadToBottom()
    }
  )
}

function addMessage(message) {
  if (!message || !message.id) return
  if (state.messages.some(existing => existing.id === message.id)) return
  state.messages.push(message)
  state.messages.sort((left, right) => left.createdAt - right.createdAt)
}

function editInbox(inboxId) {
  const inbox = state.inboxes.find(item => item.id === inboxId)
  if (!inbox) return
  state.form = {
    id: inbox.id,
    name: inbox.name,
    welcomeMessage: inbox.welcomeMessage,
    isActive: inbox.isActive
  }
  render()
}

async function copyInboxUrl() {
  if (!state.selectedInbox) return
  await navigator.clipboard.writeText(publicInboxUrl(state.selectedInbox))
  client.notify('Public inbox URL copied.', 'positive')
}

function publicInboxUrl(inbox) {
  return `${window.location.origin}/ext/supportchat/i/${encodeURIComponent(
    inbox.id
  )}`
}

function publicConversationUrl(conversation) {
  return `${window.location.origin}/ext/supportchat/c/${encodeURIComponent(
    conversation.id
  )}`
}

async function withError(fn, fallback) {
  state.error = ''
  try {
    await fn()
  } catch (error) {
    state.error = error instanceof Error ? error.message : fallback
    client.notifyError(state.error).catch(() => {})
  }
}

function render() {
  root.innerHTML = `
    <main class="sc-shell q-pa-md">
      <header class="row items-center justify-between q-mb-md q-gutter-md">
        <div>
          <h1 class="text-h5 text-weight-bold q-my-none">Support Chat</h1>
          <p class="text-caption sc-muted q-my-none">${state.inboxes.length} inbox${
            state.inboxes.length === 1 ? '' : 'es'
          }</p>
        </div>
        <button class="q-btn q-btn-item non-selectable q-btn--flat q-btn--rectangle q-btn--actionable" data-action="refresh-inboxes" type="button">Refresh</button>
      </header>

      ${state.error ? `<div class="q-banner bg-negative text-white q-mb-md q-pa-md">${escapeHtml(state.error)}</div>` : ''}

      <div class="row q-col-gutter-md">
        <section class="col-12 col-md-4">
          ${renderInboxForm()}
          ${renderInboxList()}
        </section>
        <section class="col-12 col-md-8">
          ${state.selectedInbox ? renderInboxWorkspace() : renderEmpty('Select or create an inbox.')}
        </section>
      </div>
    </main>
  `
  bindEvents()
}

function renderInboxForm() {
  return `
    <div class="sc-panel q-pa-md q-mb-md" id="inbox-form">
      <div class="row items-center justify-between q-mb-md">
        <h2 class="text-subtitle1 text-weight-bold q-my-none">${state.form.id ? 'Edit inbox' : 'New inbox'}</h2>
        ${
          state.form.id
            ? '<button class="q-btn q-btn--flat" data-action="cancel-edit" type="button">Cancel</button>'
            : ''
        }
      </div>
      <label class="block q-mb-md">
        <span class="text-caption sc-muted">Name</span>
        <input class="q-field__native sc-input" name="name" maxlength="80" value="${attr(state.form.name)}" />
      </label>
      <label class="block q-mb-md">
        <span class="text-caption sc-muted">Welcome message</span>
        <textarea class="q-field__native sc-input" name="welcomeMessage" maxlength="280">${escapeHtml(
          state.form.welcomeMessage
        )}</textarea>
      </label>
      <label class="row items-center q-mb-md">
        <input name="isActive" type="checkbox" ${state.form.isActive ? 'checked' : ''} />
        <span class="q-ml-sm">Active</span>
      </label>
      <button class="q-btn bg-primary text-white full-width" type="button" data-action="save-inbox" ${
        state.loading === 'saving' ? 'disabled' : ''
      }>${state.form.id ? 'Save inbox' : 'Create inbox'}</button>
    </div>
  `
}

function renderInboxList() {
  if (!state.inboxes.length) return renderEmpty('No inboxes')
  return `
    <div class="sc-panel q-pa-sm sc-list">
      ${state.inboxes
        .map(
          inbox => `
            <button class="sc-row ${state.selectedInbox?.id === inbox.id ? 'sc-row--active' : ''}" data-action="select-inbox" data-id="${attr(
              inbox.id
            )}" type="button">
              <span>
                <strong>${escapeHtml(inbox.name)}</strong>
                <small class="sc-url sc-muted">${escapeHtml(publicInboxUrl(inbox))}</small>
              </span>
              <span class="sc-badge">${inbox.isActive ? 'active' : 'paused'}</span>
            </button>
          `
        )
        .join('')}
    </div>
  `
}

function renderInboxWorkspace() {
  return `
    <div class="q-gutter-md">
      <div class="sc-panel q-pa-md">
        <div class="row items-start justify-between q-gutter-md">
          <div>
            <h2 class="text-subtitle1 text-weight-bold q-my-none">${escapeHtml(
              state.selectedInbox.name
            )}</h2>
            <p class="sc-url sc-muted q-my-xs">${escapeHtml(publicInboxUrl(state.selectedInbox))}</p>
          </div>
          <div class="row q-gutter-sm">
            <button class="q-btn q-btn--flat" data-action="copy-url" type="button">Copy URL</button>
            <button class="q-btn q-btn--flat" data-action="edit-inbox" data-id="${attr(
              state.selectedInbox.id
            )}" type="button">Edit</button>
            <button class="q-btn q-btn--flat text-negative" data-action="delete-inbox" type="button">Delete</button>
          </div>
        </div>
      </div>

      <div class="row q-col-gutter-md">
        <section class="col-12 col-md-5">${renderConversationList()}</section>
        <section class="col-12 col-md-7">${renderConversationThread()}</section>
      </div>
    </div>
  `
}

function renderConversationList() {
  return `
    <div class="sc-panel q-pa-sm">
      <div id="conversation-search-form" class="row items-center q-pa-sm q-gutter-sm">
        <input id="conversation-search" class="sc-input col" name="search" placeholder="Search" value="${attr(
          state.conversationSearch
        )}" />
        <button class="q-btn q-btn--flat" type="button" data-action="refresh-conversations">Refresh</button>
      </div>
      ${
        state.conversations.length
          ? `<div class="sc-list">${state.conversations
              .map(
                conversation => `
                  <button class="sc-row ${
                    state.selectedConversation?.id === conversation.id
                      ? 'sc-row--active'
                      : ''
                  }" data-action="select-conversation" data-id="${attr(
                    conversation.id
                  )}" type="button">
                    <span>
                      <strong>${escapeHtml(
                        conversation.subject || conversation.visitorName
                      )}</strong>
                      <small class="sc-muted">${escapeHtml(
                        conversation.visitorName || ''
                      )}${conversation.visitorEmail ? ` · ${escapeHtml(conversation.visitorEmail)}` : ''}</small>
                    </span>
                    <span class="sc-badge">${escapeHtml(conversation.status)}</span>
                  </button>
                `
              )
              .join('')}</div>`
          : renderEmpty('No conversations')
      }
    </div>
  `
}

function renderConversationThread() {
  if (!state.selectedConversation) return renderEmpty('Select a conversation.')
  return `
    <div class="sc-panel q-pa-md">
      <div class="row items-start justify-between q-gutter-md q-mb-md">
        <div>
          <h3 class="text-subtitle1 text-weight-bold q-my-none">${escapeHtml(
            state.selectedConversation.subject
          )}</h3>
          <p class="sc-muted q-my-xs">${escapeHtml(
            state.selectedConversation.visitorName || ''
          )}${state.selectedConversation.visitorEmail ? ` · ${escapeHtml(state.selectedConversation.visitorEmail)}` : ''}</p>
          <p class="sc-url sc-muted q-my-none">${escapeHtml(
            publicConversationUrl(state.selectedConversation)
          )}</p>
        </div>
        ${
          state.selectedConversation.status !== 'resolved'
            ? '<button class="q-btn q-btn--flat" data-action="resolve-conversation" type="button">Resolve</button>'
            : ''
        }
      </div>

      <div id="thread" class="sc-thread q-pr-xs q-mb-md">
        ${renderMessages()}
      </div>

      <div id="reply-box" class="q-gutter-sm">
        <textarea class="sc-input" name="body" maxlength="2000" placeholder="Reply" ${
          state.selectedConversation.status === 'resolved' ? 'disabled' : ''
        }></textarea>
        <button class="q-btn bg-primary text-white" type="button" data-action="send-reply" ${
          state.selectedConversation.status === 'resolved' ? 'disabled' : ''
        }>Send</button>
      </div>
    </div>
  `
}

function renderMessages() {
  if (!state.messages.length) return renderEmpty('No messages')
  return state.messages
    .map(
      message => `
        <div class="sc-message ${
          message.senderType === 'agent' ? 'sc-message--agent' : ''
        }">
          <div class="sc-bubble">
            <div class="sc-message-meta">${escapeHtml(
              message.senderName || ''
            )} · ${escapeHtml(formatTime(message.createdAt))}</div>
            <div>${escapeHtml(message.body || '')}</div>
          </div>
        </div>
      `
    )
    .join('')
}

function renderEmpty(message) {
  return `<div class="sc-empty q-pa-md text-center">${escapeHtml(message)}</div>`
}

function bindEvents() {
  root.querySelectorAll('[data-action]').forEach(element => {
    element.addEventListener('click', event => {
      const target = event.currentTarget
      const action = target.dataset.action
      const id = target.dataset.id
      if (action === 'refresh-inboxes') fetchInboxes()
      if (action === 'save-inbox') saveInbox()
      if (action === 'cancel-edit') {
        state.form = emptyForm()
        render()
      }
      if (action === 'select-inbox') selectInbox(id)
      if (action === 'edit-inbox') editInbox(id)
      if (action === 'delete-inbox') deleteSelectedInbox()
      if (action === 'copy-url') copyInboxUrl()
      if (action === 'refresh-conversations') fetchConversations()
      if (action === 'select-conversation') selectConversation(id)
      if (action === 'resolve-conversation') resolveSelectedConversation()
      if (action === 'send-reply') replyToConversation()
    })
  })
}

function byId(id) {
  return document.getElementById(id)
}

function fieldValue(container, name) {
  return String(container?.querySelector(`[name="${name}"]`)?.value || '')
}

function scrollThreadToBottom() {
  const thread = byId('thread')
  if (thread) thread.scrollTop = thread.scrollHeight
}

function formatTime(timestamp) {
  if (!timestamp) return ''
  return new Date(timestamp * 1000).toLocaleString()
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => {
    return {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[char]
  })
}

function attr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;')
}
