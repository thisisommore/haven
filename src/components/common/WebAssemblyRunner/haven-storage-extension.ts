import { HavenStorage } from './type';

// type from Extension
type BaseMessage<Api extends string> = {
  api: Api;
  requestId: string;
};

export type TRequest = BaseMessage<'LocalStorage:Request'> &
  (
    | {
        action: 'clear' | 'keys';
      }
    | {
        action: 'getItem' | 'removeItem';
        key: string;
      }
    | {
        action: 'setItem';
        key: string;
        value: string;
      }
  );

export type TResponse = BaseMessage<'LocalStorage:Response'> &
  (
    | {
        action: 'getItem';
        result: unknown;
      }
    | {
        action: 'keys';
        result: string[];
      }
    | {
        action: 'removeItem' | 'clear' | 'setItem' | 'locked';
      }
  );

function generateRequestId(): string {
  return Math.random().toString(36).slice(2, 11);
}

const promiseHandlers: Record<
  string,
  { resolve: (result: any) => void; reject: (error: any) => void }
> = {};

// establish a long-lived Port to extension
const EXT_ID = 'knjemccepbogcmlhnhffagneinknidic';
let port: chrome.runtime.Port;

function isValidResponse(msg: any): msg is TResponse {
  return msg?.requestId && msg.api === 'LocalStorage:Response';
}

let status: 'disconnected' | 'not-installed' | 'ok' = 'disconnected';

// wait for root-level { api: 'Lock:Response', action: 'unlocked' }
function waitForUnlock(timeoutMs = 120_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const onMessage = (e: MessageEvent) => {
      const data: any = e.data;
      if (data?.api === 'Lock:Response' && data?.action === 'unlocked') {
        cleanup();
        resolve();
      }
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for unlock'));
    }, timeoutMs);
    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
    };
    window.addEventListener('message', onMessage);
  });
}

// send unlock request and await broadcast
function sendUnlock(): Promise<void> {
  console.log('Sending unlock request');

  return new Promise<void>((resolve, reject) => {
    try {
      // resolve when broadcast arrives
      waitForUnlock().then(resolve).catch(reject);

      // ask extension to unlock (normal messaging, not Port)
      chrome.runtime
        .sendMessage(EXT_ID, {
          api: 'Lock:Request',
          action: 'unlock',
          requestId: generateRequestId()
        })
        .catch(reject);
    } catch (err) {
      reject(err as any);
    }
  });
}

function setupPort(): Promise<boolean> {
  return new Promise((resolve, reject) => {
    port = chrome.runtime.connect(EXT_ID, { name: 'LocalStorageChannel' });

    let settled = false;
    let retriedAfterUnlock = false;

    const sendProbe = () => {
      const probe: TRequest = {
        api: 'LocalStorage:Request',
        action: 'getItem',
        key: 'hello',
        requestId: 'init'
      };
      port.postMessage(probe);
    };

    // incoming responses on that port
    port.onMessage.addListener((msg) => {
      // we want to settle only once for init probe
      if (!settled) {
        if (msg?.requestId === 'init' && msg?.action === 'locked') {
          if (!retriedAfterUnlock) {
            retriedAfterUnlock = true;
            // trigger unlock, then re-probe once
            sendUnlock()
              .then(() => {
                resolve(true);
              })
              .catch((e) => {
                console.error('Error sending unlock message', e);
                settled = true;
                resolve(false);
              });
            return;
          }
          settled = true;
          // Extension responded, port is functional even if locked
          status = 'ok';
          return;
        }
        // any non-locked reply completes init as ok
        settled = true;
        status = 'ok';
        resolve(true);
      }

      if (msg?.requestId && msg.api === 'LocalStorage:Response') {
        const handler = promiseHandlers[msg.requestId];

        if (handler && isValidResponse(msg)) {
          if (msg.action === 'locked') {
            handler.reject(new Error('Extension has been locked'));
          } else {
            handler.resolve('result' in msg ? msg.result : undefined);
          }
          delete promiseHandlers[msg.requestId];
        }
      }
    });

    port.onDisconnect.addListener(() => {
      if (chrome.runtime.lastError) {
        if (
          chrome.runtime.lastError.message ===
          'Could not establish connection. Receiving end does not exist.'
        ) {
          console.warn('Secure Extension not installed');
          status = 'not-installed';
          resolve(false);
        } else {
          status = 'disconnected';
          reject(chrome.runtime.lastError);
        }
      }
    });

    // send message to check if extension is responding to request
    sendProbe();
  });
}

function sendViaPort<T>(action: 'clear' | 'keys'): Promise<T>;
function sendViaPort<T>(action: 'getItem' | 'removeItem', key: string): Promise<T>;
function sendViaPort<T>(action: 'setItem', key: string, value: any): Promise<T>;
function sendViaPort<T>(
  action: 'getItem' | 'setItem' | 'removeItem' | 'clear' | 'keys',
  key?: string,
  value?: any
): Promise<T> {
  const requestId = generateRequestId();

  return new Promise<T>(async (resolve, reject) => {
    promiseHandlers[requestId] = { resolve, reject };
    let request: TRequest;

    if (action === 'clear' || action === 'keys') {
      request = { api: 'LocalStorage:Request', action, requestId };
    } else if (action === 'getItem' || action === 'removeItem') {
      request = { api: 'LocalStorage:Request', action, key: key!, requestId };
    } else if (action === 'setItem') {
      request = { api: 'LocalStorage:Request', action, key: key!, value: value!, requestId };
    } else {
      throw new Error(`Unknown action: ${action}`);
    }

    // ports get disconnected after inactivity
    if (status === 'disconnected') {
      console.log('disconnected, reconnecting port');
      await setupPort();
    }

    try {
      port.postMessage(request);
    } catch (err) {
      console.error('postMessage failed, reconnecting port', err);
      setupPort();
      // retry once after reconnect
      try {
        port.postMessage({ api: 'LocalStorage:Request', action, key, value, requestId });
      } catch (retryErr) {
        delete promiseHandlers[requestId];
        reject(retryErr);
      }
    }
  });
}

export const havenStorageExtension = {
  getItem(key) {
    return sendViaPort('getItem', key);
  },
  setItem(key, value) {
    return sendViaPort('setItem', key, value);
  },
  delete(key) {
    return sendViaPort('removeItem', key);
  },
  clear() {
    return sendViaPort('clear');
  },
  keys() {
    return sendViaPort('keys');
  },
  key(_idx) {
    // not implemented on SW side
    return Promise.reject('not implemented');
  },
  isAvailable() {
    return true;
  },
  init() {
    return setupPort();
  }
} satisfies HavenStorage;
