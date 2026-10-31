import { removeBackground } from '@imgly/background-removal'

self.onmessage = async (event: MessageEvent<Blob>) => {
  try {
    const result = await removeBackground(event.data, {
      device: 'cpu',
      model: 'isnet_quint8',
      proxyToWorker: false,
      output: { format: 'image/png' },
      progress: (key, current, total) => {
        self.postMessage({ type: 'progress', key, current, total })
      },
    })
    self.postMessage({ type: 'result', blob: result })
  } catch (error) {
    console.warn('Background removal failed:', error)
    self.postMessage({ type: 'error' })
  }
}
