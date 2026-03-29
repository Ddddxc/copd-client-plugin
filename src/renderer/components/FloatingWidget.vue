<template>
  <div class="floating-wrapper" @mouseenter="onEnter" @mouseleave="onLeave" @click="onClick">
    <div class="floating-ball" :style="dragStyle" :class="{ 'analyzing': status === 'analyzing', 'done': status === 'done' }">
      <div class="ball-icon">
        <svg v-if="status === 'analyzing'" class="spinner" viewBox="0 0 50 50">
          <circle cx="25" cy="25" r="20" fill="none" stroke="currentColor" stroke-width="4"></circle>
        </svg>
        <svg v-else-if="status === 'done'" class="checkmark" viewBox="0 0 50 50">
          <path d="M14 27l8 8 14-16" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"></path>
        </svg>
        <svg v-else class="camera" viewBox="0 0 50 50">
          <rect x="10" y="15" width="30" height="22" rx="2" fill="none" stroke="currentColor" stroke-width="3"></rect>
          <circle cx="25" cy="26" r="6" fill="none" stroke="currentColor" stroke-width="2"></circle>
          <path d="M18 15l2-4h10l2 4" fill="none" stroke="currentColor" stroke-width="2"></path>
        </svg>
      </div>
      <div class="ball-actions">
        <button class="action-btn primary" @click.stop="$emit('take')" title="截图分析">
          <svg viewBox="0 0 24 24"><path d="M21 6h-3.17L16 4h-6v2h5.12l1.83 2H21v12H5v-9H3v9c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zM8 14c0 2.76 2.24 5 5 5s5-2.24 5-5-2.24-5-5-5-5 2.24-5 5zm5-3c1.65 0 3 1.35 3 3s-1.35 3-3 3-3-1.35-3-3 1.35-3 3-3zM5 6h3V4H5V1H3v3H0v2h3v3h2z" fill="currentColor"/></svg>
        </button>
        <button class="action-btn" @click.stop="$emit('records')" title="查看记录">
          <svg viewBox="0 0 24 24"><path d="M19 3h-4.18C14.4 1.84 13.3 1 12 1s-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm0 4c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm6 12H6v-1.4c0-2 4-3.1 6-3.1s6 1.1 6 3.1V19z" fill="currentColor"/></svg>
        </button>
      </div>
      <div class="ball-status">
        <span v-if="status==='analyzing'">分析中</span>
        <span v-else-if="status==='done'">已完成</span>
        <span v-else>医疗质控</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'

const props = defineProps({ latest: Object, status: String })
const emit = defineEmits(['reset'])

const isOpen = ref(false)
let timer = null
const dragStyle = computed(() => ({ '-webkit-app-region': isOpen.value ? 'drag' : 'no-drag' }))

function onEnter () {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  isOpen.value = true
  window.ball && window.ball.expand && window.ball.expand()
}

function onLeave () {
  if (window.__lockBall === true) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    if (isOpen.value) {
      isOpen.value = false
      window.ball && window.ball.collapse && window.ball.collapse()
      if (props.status === 'done') emit('reset')
    }
  }, 400)
}

function onClick () {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  isOpen.value = true
  window.ball && window.ball.expand && window.ball.expand()
}
</script>

<style scoped>
.floating-wrapper {
  position: fixed;
  left: 0;
  top: 0;
  width: 150px;
  height: 150px;
  overflow: hidden;
  border-radius: 50%;
  pointer-events: none;
}

.floating-ball {
  width: 150px;
  height: 150px;
  border-radius: 50%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: #fff;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  box-shadow: 0 10px 40px rgba(102, 126, 234, 0.4);
  user-select: none;
  border: 2px solid rgba(255, 255, 255, 0.2);
  transition: all 0.3s ease;
  pointer-events: auto;
}

.floating-ball.analyzing {
  background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
  animation: pulse 2s ease-in-out infinite;
}

.floating-ball.done {
  background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
}

@keyframes pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.05); }
}

.ball-icon {
  width: 40px;
  height: 40px;
  color: white;
  -webkit-app-region: no-drag;
}

.ball-icon svg {
  width: 100%;
  height: 100%;
}

.spinner {
  animation: rotate 1.5s linear infinite;
}

@keyframes rotate {
  100% { transform: rotate(360deg); }
}

.checkmark {
  animation: checkmark 0.5s ease-in-out;
}

@keyframes checkmark {
  0% { opacity: 0; transform: scale(0); }
  100% { opacity: 1; transform: scale(1); }
}

.ball-actions {
  display: flex;
  gap: 8px;
  -webkit-app-region: no-drag;
}

.action-btn {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.2);
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  backdrop-filter: blur(10px);
}

.action-btn:hover {
  background: rgba(255, 255, 255, 0.3);
  transform: scale(1.1);
}

.action-btn.primary {
  background: rgba(255, 255, 255, 0.3);
}

.action-btn svg {
  width: 20px;
  height: 20px;
}

.ball-status {
  font-size: 11px;
  font-weight: 500;
  text-align: center;
  -webkit-app-region: no-drag;
  opacity: 0.95;
  letter-spacing: 0.5px;
}
</style>
