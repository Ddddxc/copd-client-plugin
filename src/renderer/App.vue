<template>
  <div v-if="view==='float'" class="float-container">
    <FloatingWidget @take="handleTake" @records="openHistory" :latest="latest" :status="analysisStatus" @reset="analysisStatus='idle'" />
  </div>
  <div v-else class="main-container">
    <div class="list-section">
      <History @open="openDetail" />
    </div>
    <div class="detail-section">
      <RecordDetail ref="detailRef" />
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage, ElLoading } from 'element-plus'
import FloatingWidget from './components/FloatingWidget.vue'
import History from './pages/History.vue'
import RecordDetail from './pages/RecordDetail.vue'

const latest = ref(null)
const analysisStatus = ref('idle')
const detailRef = ref(null)
const view = new URLSearchParams(window.location.search).get('view') || 'history'

async function handleTake() {
  if (analysisStatus.value === 'analyzing') return
  try { window.ball && window.ball.expand && window.ball.expand() } catch (_) {}
  window.__lockBall = true
  analysisStatus.value = 'analyzing'

  const loading = ElLoading.service({
    lock: true,
    text: '正在分析中，请稍候...',
    background: 'rgba(0, 0, 0, 0.7)',
    fullscreen: true,
    customClass: 'analysis-loading'
  })

  try {
    await window.api.fullScreenshot()
    loading.close()
    window.__lockBall = false
    analysisStatus.value = 'done'
    ElMessage({
      message: '分析完成',
      type: 'success',
      duration: 3000,
      showClose: true
    })
  } catch (e) {
    loading.close()
    window.__lockBall = false
    analysisStatus.value = 'idle'
    const m = e && e.message ? e.message : String(e || '')
    window.api.notify({ title: '分析失败', body: m })
  }
}
function openHistory() { window.api.showHistory() }

function openDetail(id) { detailRef.value?.open(id) }

onMounted(() => {
  if (view === 'float') {
    document.documentElement.style.backgroundColor = 'transparent'
    document.body.style.backgroundColor = 'transparent'
    document.body.style.margin = '0'
    document.body.style.overflow = 'hidden'
  }
  window.api.onLatest((data) => {
    latest.value = data
    analysisStatus.value = 'done'
  })
  window.api.onShortcut(() => handleTake())
})
</script>

<style>
body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  background: #f3f6fc;
}

.float-container {
  width: 150px;
  height: 150px;
  padding: 0;
  overflow: hidden;
  border-radius: 50%;
  background-color: transparent !important;
}

body:has(.float-container) {
  background-color: transparent !important;
}

.main-container {
  display: flex;
  height: 100vh;
  gap: 20px;
  padding: 20px;
  box-sizing: border-box;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.list-section {
  flex: 0 0 600px;
  background-color: white;
  border-radius: 16px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.detail-section {
  flex: 1;
  background-color: white;
  border-radius: 16px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
  overflow-y: auto;
  padding: 20px;
}
</style>
