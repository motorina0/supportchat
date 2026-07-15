;(function () {
  let bridgePortPromise = null
  const bridgeEventHandlers = new Map()
  const LOG_PREFIX = '[supportchat extension]'

  function createLNbitsSupportChatClient({extensionId}) {
    const baseUrl = `/api/v1/ext/${extensionId}`

    return {
      context() {
        return bridgeRequest({action: 'context'})
      },

      notify(message, level = 'info') {
        return bridgeRequest({
          action: 'ui.notify',
          level,
          message: String(message || '')
        })
      },

      notifyError(error) {
        return this.notify(errorMessage(error), 'negative')
      },

      replaceRoute(path) {
        return bridgeRequest({
          action: 'navigation.replace',
          path
        })
      },

      createInbox(payload) {
        return request(`${baseUrl}/inboxes`, {
          method: 'POST',
          body: payload
        })
      },

      updateInbox(inboxId, payload) {
        return request(`${baseUrl}/inboxes/${encodeURIComponent(inboxId)}`, {
          method: 'PUT',
          body: payload
        })
      },

      listInboxes(params = {}) {
        return request(withQuery(`${baseUrl}/inboxes`, params))
      },

      deleteInbox(inboxId) {
        return request(`${baseUrl}/inboxes/${encodeURIComponent(inboxId)}`, {
          method: 'DELETE'
        })
      },

      listConversations(inboxId, params = {}) {
        return request(
          withQuery(
            `${baseUrl}/inboxes/${encodeURIComponent(inboxId)}/conversations`,
            params
          )
        )
      },

      listMessages(conversationId, params = {}) {
        return request(
          withQuery(
            `${baseUrl}/conversations/${encodeURIComponent(
              conversationId
            )}/messages`,
            params
          )
        )
      },

      replyConversation(conversationId, payload) {
        return request(
          `${baseUrl}/conversations/${encodeURIComponent(
            conversationId
          )}/reply`,
          {
            method: 'POST',
            body: payload
          }
        )
      },

      resolveConversation(conversationId) {
        return request(
          `${baseUrl}/conversations/${encodeURIComponent(
            conversationId
          )}/resolve`,
          {
            method: 'POST',
            body: {}
          }
        )
      },

      getPublicInbox(inboxId) {
        return request(`${baseUrl}/public/inboxes/${encodeURIComponent(inboxId)}`)
      },

      startConversation(inboxId, payload) {
        return request(
          `${baseUrl}/public/inboxes/${encodeURIComponent(
            inboxId
          )}/conversations`,
          {
            method: 'POST',
            body: payload
          }
        )
      },

      getPublicConversation(conversationId, params = {}) {
        return request(
          withQuery(
            `${baseUrl}/public/conversations/${encodeURIComponent(
              conversationId
            )}`,
            params
          )
        )
      },

      postPublicMessage(conversationId, payload) {
        return request(
          `${baseUrl}/public/conversations/${encodeURIComponent(
            conversationId
          )}/messages`,
          {
            method: 'POST',
            body: payload
          }
        )
      },

      subscribeWebsocket(itemId, callback) {
        return subscribeWebsocket(itemId, callback)
      },

      publishWebsocket(itemId, data = {}) {
        return bridgeRequest({
          action: 'websocket.publish',
          itemId,
          data
        })
      }
    }
  }

  function withQuery(path, params = {}) {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue
      query.set(key, String(value))
    }
    const suffix = query.toString() ? `?${query.toString()}` : ''
    return `${path}${suffix}`
  }

  function request(path, {method = 'GET', body = null} = {}) {
    return bridgeRequest({
      action: 'api',
      method,
      path,
      body
    })
      .then(unwrapRuntimeResponse)
      .catch(error => {
        logFailure('API request failed.', {method, path, body, error})
        throw error
      })
  }

  function subscribeWebsocket(itemId, callback) {
    if (typeof callback !== 'function') {
      return Promise.reject(new Error('Websocket subscription needs a callback.'))
    }

    const subscriptionId = requestId()
    bridgeEventHandlers.set(subscriptionId, callback)

    return bridgeRequest({
      action: 'websocket.subscribe',
      subscriptionId,
      itemId
    })
      .then(() => {
        let active = true
        return () => {
          if (!active) return
          active = false
          bridgeEventHandlers.delete(subscriptionId)
          bridgeRequest({
            action: 'websocket.unsubscribe',
            subscriptionId
          }).catch(error => {
            logFailure('Websocket unsubscribe failed.', {subscriptionId, error})
          })
        }
      })
      .catch(error => {
        bridgeEventHandlers.delete(subscriptionId)
        logFailure('Websocket subscription failed.', {
          itemId,
          subscriptionId,
          error
        })
        throw error
      })
  }

  function bridgeRequest(message) {
    if (window.parent === window) {
      const error = new Error('LNbits extension bridge is not available.')
      logFailure('Bridge unavailable.', {message, error})
      return Promise.reject(error)
    }

    return getBridgePort()
      .then(port => bridgePortRequest(port, message))
      .catch(error => {
        if (message.action !== 'api') {
          logFailure('Bridge request failed.', {message, error})
        }
        throw error
      })
  }

  function getBridgePort() {
    if (!bridgePortPromise) {
      bridgePortPromise = connectBridge()
    }
    return bridgePortPromise
  }

  function connectBridge() {
    const id = requestId()
    const channel = new MessageChannel()
    const parentOrigin = new URL(window.location.href).origin

    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        channel.port1.removeEventListener('message', onMessage)
        channel.port1.close()
        reject(new Error('LNbits extension bridge timed out.'))
      }, 30000)

      function onMessage(event) {
        if (event.currentTarget !== channel.port1) return
        const response = event.data
        if (
          !response ||
          response.type !== 'lnbits-extension:connected' ||
          response.id !== id
        ) {
          return
        }

        window.clearTimeout(timeout)
        channel.port1.removeEventListener('message', onMessage)
        attachBridgeEvents(channel.port1)
        resolve(channel.port1)
      }

      channel.port1.addEventListener('message', onMessage)
      channel.port1.start()
      window.parent.postMessage(
        {
          type: 'lnbits-extension:connect',
          id
        },
        parentOrigin,
        [channel.port2]
      )
    })
  }

  function bridgePortRequest(port, message) {
    const id = requestId()

    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        port.removeEventListener('message', onMessage)
        reject(new Error('LNbits extension bridge timed out.'))
      }, 30000)

      function onMessage(event) {
        if (event.currentTarget !== port) return
        const response = event.data
        if (
          !response ||
          response.type !== 'lnbits-extension:response' ||
          response.id !== id
        ) {
          return
        }

        window.clearTimeout(timeout)
        port.removeEventListener('message', onMessage)
        if (response.ok === false) {
          reject(new Error(response.error || 'Extension call failed.'))
          return
        }
        resolve(response.data)
      }

      port.addEventListener('message', onMessage)
      port.postMessage({
        type: 'lnbits-extension:request',
        id,
        ...message
      })
    })
  }

  function attachBridgeEvents(port) {
    if (port.__lnbitsSupportChatEventsAttached) return
    port.__lnbitsSupportChatEventsAttached = true
    port.addEventListener('message', event => {
      if (event.currentTarget !== port) return
      const message = event.data
      if (!message || message.type !== 'lnbits-extension:event') return

      const handler = bridgeEventHandlers.get(message.subscriptionId)
      if (!handler) return
      handler(message)
    })
  }

  function unwrapRuntimeResponse(value) {
    if (typeof value === 'string') {
      value = JSON.parse(value)
    }

    if (value && value.ok === false) {
      throw new Error(value.error || 'Extension call failed.')
    }

    if (value && value.ok === true && 'data' in value) {
      return value.data
    }

    return value
  }

  function requestId() {
    return (
      window.crypto?.randomUUID?.() ||
      `request_${Date.now()}_${Math.random().toString(36).slice(2)}`
    )
  }

  function errorMessage(value) {
    return value instanceof Error ? value.message : String(value)
  }

  function logFailure(message, details = {}) {
    if (!window.console || typeof window.console.error !== 'function') return
    window.console.error(LOG_PREFIX, message, details)
  }

  window.createLNbitsSupportChatClient = createLNbitsSupportChatClient
})()
