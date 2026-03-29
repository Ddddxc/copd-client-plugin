<template>
  <div class="history-wrap">
    <div class="search-bar">
      <el-input
        v-model="searchKeyword"
        placeholder="请输入患者姓名或ID"
        clearable
        @clear="handleSearch"
        @keyup.enter="handleSearch"
        class="search-input"
      >
        <template #append>
          <el-button @click="handleSearch">搜索</el-button>
        </template>
      </el-input>
    </div>
    <div class="table-container">
      <el-table :data="records" stripe border class="table" height="100%" :header-cell-style="headerCellStyle">
        <el-table-column type="index" label="序号" width="70" align="center" />
        <el-table-column prop="patient_id" label="患者ID" min-width="150" show-overflow-tooltip />
        <el-table-column prop="patient_name" label="患者姓名" min-width="130" show-overflow-tooltip />
        <el-table-column label="诊断时间" min-width="180">
          <template #default="{ row }">{{ formatTime(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="120" align="center" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" link @click="$emit('open', row.id)">查看详情</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>
    <div class="pager">
      <el-pagination 
        background
        :current-page="page" 
        :page-size="pageSize" 
        :total="totalRecords" 
        @current-change="handlePageChange" 
        layout="prev, pager, next" 
      />
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';

const emit = defineEmits(['open']);

const records = ref([]);
const page = ref(1);
const pageSize = ref(15);
const totalRecords = ref(0);
const searchKeyword = ref('');
const headerCellStyle = () => ({ background: '#4f67d8', color: '#ffffff', fontWeight: 600 });

const loadRecords = async () => {
  try {
    const filter = {};
    if (searchKeyword.value) {
      filter.patientName = searchKeyword.value;
      filter.patientId = searchKeyword.value;
    }
    const out = await window.api.analysesList({ page: page.value, pageSize: pageSize.value, filter });
    records.value = Array.isArray(out?.rows) ? out.rows : [];
    totalRecords.value = Number(out?.total || 0);
  } catch (error) {
    console.error('Error loading records:', error);
  }
};

const handleSearch = () => {
  page.value = 1;
  loadRecords();
};

const handlePageChange = (newPage) => {
  page.value = newPage;
  loadRecords();
};

const formatTime = (ts) => {
  const t = Number(ts || 0);
  if (!t) return '';
  const d = new Date(t);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

onMounted(() => {
  loadRecords();
});
</script>

<style scoped>
.history-wrap {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: linear-gradient(to bottom, #f8f9fa 0%, #ffffff 100%);
}

.search-bar {
  padding: 20px;
  background: white;
  border-bottom: 2px solid #e9ecef;
}

.search-input {
  width: 100%;
}

.search-input :deep(.el-input-group__append) {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
}

.search-input :deep(.el-input-group__append):hover {
  opacity: 0.9;
}

.table-container {
  flex: 1;
  overflow: hidden;
  padding: 0 20px;
  margin-top: 10px;
}

.table {
  width: 100%;
  border-radius: 8px;
  overflow: hidden;
}

.table :deep(.el-table__header th.el-table__cell) {
  border-color: rgba(255, 255, 255, 0.2) !important;
}

.table :deep(.el-table__row:hover) {
  background-color: #f0f4ff;
}

.pager {
  display: flex;
  justify-content: center;
  padding: 20px;
}
</style>
