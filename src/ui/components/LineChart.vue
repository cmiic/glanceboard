<script setup>
import { ref, watch } from 'vue'
import {
  Chart as ChartJS,
  Title,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  LineElement,
  PointElement
} from 'chart.js'
import { Line } from 'vue-chartjs'

ChartJS.register(Title, Tooltip, Legend, CategoryScale, LinearScale, PointElement, LineElement)

const props = defineProps({
  id: { type: Number, required: true },
  labels: { type: Array, required: true },
  elapsed: { type: Array, required: true }
})

const data = ref({ labels: [], datasets: [] })

const options = {
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  plugins: { legend: { display: false } },
  scales: { x: { display: false }, y: { ticks: { maxTicksLimit: 3 } } },
  elements: { point: { radius: 0 } }
}

// Arrays are newest-first; reverse to chart oldest -> newest left to right.
watch(() => [props.labels, props.elapsed], () => {
  data.value = {
    labels: props.labels.slice(0, 12).reverse().map(d => new Date(d).toLocaleTimeString()),
    datasets: [
      {
        label: 'Load time [ms]',
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, .2)',
        fill: true,
        tension: 0.3,
        data: props.elapsed.slice(0, 12).reverse()
      }
    ]
  }
}, { immediate: true, deep: true })
</script>

<template>
  <Line
    :data="data"
    :options="options"
  />
</template>
