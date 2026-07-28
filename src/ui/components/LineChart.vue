<script setup>
import { ref, computed, watch } from 'vue'
import {
  Chart as ChartJS,
  Tooltip,
  CategoryScale,
  LinearScale,
  LineElement,
  PointElement
} from 'chart.js'
import { Line } from 'vue-chartjs'
import { chartSeries, seriesSignature } from '@/lib/chart.js'

ChartJS.register(Tooltip, CategoryScale, LinearScale, PointElement, LineElement)

const props = defineProps({
  labels: { type: Array, required: true },
  elapsed: { type: Array, required: true }
})

const options = {
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  // Resolve the tooltip by x-index from anywhere in the plot area. Chart.js defaults to
  // nearest + intersect, which combined with radius-0 points (hitRadius 1) shrinks the hover
  // target to a 1px disc around each sample — practically unhittable on a 90px-tall tile chart.
  interaction: { mode: 'index', intersect: false },
  scales: { x: { display: false }, y: { ticks: { maxTicksLimit: 3 } } },
  // Invisible at rest so the line stays clean; a dot appears under the cursor to show which
  // sample the tooltip is reading.
  elements: { point: { radius: 0, hitRadius: 8, hoverRadius: 3 } }
}

const series = computed(() => chartSeries(props.labels, props.elapsed))
const data = ref({ labels: [], datasets: [] })

// Rebuild only when the charted values actually change. The dashboard replaces its whole results
// object on every storage write — one per preview load, per tile — and replacing `data` re-renders
// the chart, which dismisses an open tooltip mid-hover.
watch(() => seriesSignature(series.value), () => {
  data.value = {
    labels: series.value.timestamps.map(t => new Date(t).toLocaleTimeString()),
    datasets: [
      {
        label: 'Load time [ms]',
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, .2)',
        fill: true,
        tension: 0.3,
        data: series.value.values
      }
    ]
  }
}, { immediate: true })
</script>

<template>
  <Line
    :data="data"
    :options="options"
  />
</template>
