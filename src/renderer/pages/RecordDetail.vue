<template>
  <div v-if="record" class="detail-wrap">
    <div class="head">
      <el-descriptions title="患者基础信息" :column="1" border class="meta">
        <el-descriptions-item label="患者ID">{{ record.patient_id }}</el-descriptions-item>
        <el-descriptions-item label="患者姓名">{{ record.patient_name }}</el-descriptions-item>
        <el-descriptions-item label="诊断时间">{{ formatTime(record.created_at) }}</el-descriptions-item>
      </el-descriptions>
      <div class="shot-wrapper">
        <el-image
          :src="formatLocalPath(record.screenshot_path)"
          fit="contain"
          class="shot"
          :preview-src-list="[formatLocalPath(record.screenshot_path)]"
          preview-teleported
        >
          <template #error>
            <div class="image-error">加载失败</div>
          </template>
        </el-image>
      </div>
    </div>

    <el-divider border-style="dashed" />

    <div class="images" v-if="images.length > 0">
      <div class="images-title">预测分析图片</div>
      <div class="grid">
        <el-card v-for="image in images" :key="image.image_path" shadow="hover" class="img-card" :body-style="{ padding: '10px' }">
          <el-image
            :src="formatLocalPath(image.image_path)"
            :preview-src-list="previewList"
            fit="contain"
            class="card-img"
            preview-teleported
          >
            <template #error>
              <div class="image-error">加载失败</div>
            </template>
          </el-image>
          <div class="img-kind">类型: {{ image.kind }}</div>
        </el-card>
      </div>
    </div>
    <el-empty v-else description="暂无预测图片" />
  </div>
  <el-empty v-else description="请从左侧列表选择一条记录以查看详情" />
</template>

<script setup>
import { ref, computed } from 'vue';

const record = ref(null);
const images = ref([]);
const curId = ref(null);

const formatLocalPath = (path) => {
  if (!path) return '';
  if (path.startsWith('http') || path.startsWith('data:') || path.startsWith('blob:')) return path;
  
  let rawPath = String(path);
  
  // 扒掉所有已存在的自定义前缀
  if (rawPath.startsWith('app-resource://')) {
    rawPath = rawPath.replace(/^app-resource:\/\/*/i, '');
    try { rawPath = decodeURIComponent(rawPath); } catch (e) {}
  }
  if (rawPath.startsWith('file://')) {
    rawPath = rawPath.replace(/^file:\/\/*/i, '');
    try { rawPath = decodeURIComponent(rawPath); } catch (e) {}
  }
  
  // 统一转为正斜杠
  rawPath = rawPath.replace(/\\/g, '/');
  
  // 匹配 Windows 驱动器盘符 (e.g. D:/path)
  const winMatch = rawPath.match(/^([a-zA-Z]):\/(.*)$/);
  if (winMatch) {
    const drive = winMatch[1].toLowerCase();
    const rest = winMatch[2];
    // 构造这种格式：app-resource://d/path/to/file.png
    // 这种格式最稳，Chromium 不会乱吃冒号
    return `app-resource://${drive}/${encodeURI(rest)}`;
  }
  
  // 如果不是 Windows 绝对路径，退回到简单的编码格式
  return `app-resource://local/${encodeURI(rawPath.replace(/^\/+/, ''))}`;
};

const previewList = computed(() => {
  return images.value.map(i => formatLocalPath(i.image_path));
});

const loadRecordDetail = async (id) => {
  try {
    const recordId = Number(id || curId.value);
    if (!recordId) return;
    const res = await window.api.analysesGet(recordId);
    record.value = res;
    images.value = Array.isArray(res?.images) ? res.images : [];
  } catch (error) {
    console.error('Error loading record details:', error);
  }
};

const open = (id) => {
  curId.value = Number(id);
  loadRecordDetail(curId.value);
};

const formatTime = (ts) => {
  const t = Number(ts || 0);
  if (!t) return '';
  const d = new Date(t);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

defineExpose({
  open
});
</script>

<style scoped>
.detail-wrap {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 8px;
}

.head {
  display: flex;
  gap: 24px;
  align-items: stretch;
  background: white;
  padding: 20px;
  border-radius: 12px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
}

.meta {
  flex: 1;
  min-width: 250px;
}

.meta :deep(.el-descriptions__title) {
  font-size: 18px;
  font-weight: 600;
  color: #667eea;
}

.shot-wrapper {
  flex: 0 0 320px;
  display: flex;
  justify-content: center;
  align-items: center;
  background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
  border-radius: 12px;
  overflow: hidden;
  padding: 10px;
}

.shot {
  width: 100%;
  height: 200px;
  border-radius: 8px;
  transition: transform 0.3s ease;
  cursor: pointer;
}

.shot:hover {
  transform: scale(1.05);
}

.images-title {
  font-size: 20px;
  font-weight: 600;
  color: #667eea;
  margin-bottom: 16px;
  padding-left: 12px;
  border-left: 4px solid #667eea;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 20px;
}

.img-card {
  border-radius: 12px;
  overflow: hidden;
  transition: transform 0.3s ease, box-shadow 0.3s ease;
}

.img-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 24px rgba(102, 126, 234, 0.2);
}

.card-img {
  width: 100%;
  height: 160px;
  border-radius: 8px;
  cursor: pointer;
}

.img-kind {
  margin-top: 10px;
  font-size: 12px;
  color: #667eea;
  text-align: center;
  background: linear-gradient(135deg, #f0f4ff 0%, #e8ecff 100%);
  padding: 6px;
  border-radius: 6px;
  font-weight: 500;
}

.image-error {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: #999;
  font-size: 14px;
}
</style>
