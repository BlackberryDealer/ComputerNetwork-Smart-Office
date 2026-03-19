import React, { useState, useEffect } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler } from 'chart.js';
import { Line } from 'react-chartjs-2';
import { io } from 'socket.io-client';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

const socket = io();

const ChartOverlay = () => {
  const [timeRange, setTimeRange] = useState(10); // in minutes
  const [chartData, setChartData] = useState({
    labels: [],
    tempPoints: [],
    acPoints: [],
    motionPoints1: [],
    motionPoints2: [],
    motionPoints3: []
  });

  const fetchData = async () => {
    try {
      const res = await fetch(`/api/chart-data?minutes=${timeRange}`);
      const data = await res.json();
      
      if (!data || !data.temperature || !data.acEvents || !data.motionEvents) {
        console.error("Invalid data format received:", data);
        return;
      }
      
      const labels = [];
      const tempPoints = [];
      const acPoints = [];
      const motion1 = [];
      const motion2 = [];
      const motion3 = [];
      
      // We will loop from the earliest to latest temperature points
      const parsedTemps = data.temperature.map(t => ({...t, timeMs: new Date(t.timestamp).getTime()})).sort((a,b) => a.timeMs - b.timeMs);
      const parsedAc = data.acEvents.map(a => ({...a, timeMs: new Date(a.timestamp).getTime()})).sort((a,b) => a.timeMs - b.timeMs);
      const parsedMotion = data.motionEvents.map(m => ({...m, timeMs: new Date(m.timestamp).getTime()})).sort((a,b) => a.timeMs - b.timeMs);
      
      parsedTemps.forEach(t => {
        labels.push(new Date(t.timestamp).toLocaleTimeString());
        tempPoints.push(t.temp);
        
        // Find nearest AC event status
        let closestAcStatus = 0;
        if (parsedAc.length > 0) {
          closestAcStatus = parsedAc.reduce((prev, curr) => {
            return (Math.abs(curr.timeMs - t.timeMs) < Math.abs(prev.timeMs - t.timeMs) ? curr : prev);
          }).status;
        }
        acPoints.push(closestAcStatus);

        // Find nearest Motion event status
        let closestMotion = { zone1: 0, zone2: 0, zone3: 0 };
        if (parsedMotion.length > 0) {
          closestMotion = parsedMotion.reduce((prev, curr) => {
            return (Math.abs(curr.timeMs - t.timeMs) < Math.abs(prev.timeMs - t.timeMs) ? curr : prev);
          });
        }
        motion1.push(closestMotion.zone1);
        motion2.push(closestMotion.zone2);
        motion3.push(closestMotion.zone3);
      });

      setChartData({
        labels,
        tempPoints,
        acPoints,
        motionPoints1: motion1,
        motionPoints2: motion2,
        motionPoints3: motion3
      });
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchData();
    let timeoutId;
    
    const handleUpdate = (data) => {
      // Refresh chart on relevant updates
      if (data.topic === 'smartoffice/sensors' || data.topic === 'office/commands/node_b' || data.topic === 'smartoffice/status/node_b' || data.topic.startsWith('redis/')) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fetchData(), 300);
      }
    };
    
    socket.on('sensor-update', handleUpdate);

    return () => {
      socket.off('sensor-update', handleUpdate);
      clearTimeout(timeoutId);
    };
  }, [timeRange]); // refetch when timeRange changes

  const commonOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: { legend: { display: false } },
    elements: { point: { radius: 0, hitRadius: 10, hoverRadius: 4 } }, // Remove default dots which clutter the lines
    scales: { x: { ticks: { autoSkip: true, maxTicksLimit: 10 } } }
  };

  const getChartData = (label, data, color, yOptions = {}) => ({
    labels: chartData.labels,
    datasets: [{
      label,
      data,
      borderColor: color,
      backgroundColor: color + '33',
      fill: true,
      stepped: yOptions.stepped || false,
      tension: yOptions.stepped ? 0 : 0.4
    }]
  });

  return (
    <div style={{ padding: '1.5rem', backgroundColor: '#fff', borderRadius: '1rem', marginTop: '1rem', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h3 style={{ margin: 0, color: '#1f2937' }}>System Telemetry</h3>
        <select 
          value={timeRange} 
          onChange={(e) => setTimeRange(Number(e.target.value))}
          style={{ padding: '0.5rem 1rem', borderRadius: '0.5rem', border: '1px solid #d1d5db', outline: 'none', backgroundColor: '#f9fafb', fontWeight: 600, color: '#4b5563', cursor: 'pointer' }}
        >
          <option value={5}>Last 5 mins</option>
          <option value={10}>Last 10 mins</option>
          <option value={30}>Last 30 mins</option>
          <option value={60}>Last 1 hour</option>
        </select>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
        {/* Chart 1: Temperature */}
        <div style={{ height: '200px' }}>
          <h4 style={{ margin: '0 0 0.5rem 0', color: '#4b5563', fontSize: '0.9rem' }}>Room Temperature (°C)</h4>
          <Line 
            options={{...commonOptions, scales: { ...commonOptions.scales, y: { type: 'linear', display: true, position: 'left' } }}} 
            data={getChartData('Temperature (°C)', chartData.tempPoints, '#ef4444')} 
          />
        </div>

        {/* Chart 2: AC Speed */}
        <div style={{ height: '200px' }}>
          <h4 style={{ margin: '0 0 0.5rem 0', color: '#4b5563', fontSize: '0.9rem' }}>Aircon Speed (0=OFF, 1=SLOW, 2=FAST)</h4>
          <Line 
            options={{...commonOptions, scales: { ...commonOptions.scales, y: { type: 'linear', display: true, position: 'left', min: 0, max: 2, ticks: { stepSize: 1 } } }}} 
            data={getChartData('AC Speed', chartData.acPoints, '#3b82f6', { stepped: true })} 
          />
        </div>

        {/* Chart 3: Motion detection (Topology-like visual using multi-line/area) */}
        <div style={{ height: '240px' }}>
          <h4 style={{ margin: '0 0 0.5rem 0', color: '#4b5563', fontSize: '0.9rem' }}>Motion Detected Topology</h4>
          <Line 
            options={{
              ...commonOptions, 
              plugins: { legend: { display: true, position: 'top', labels: { usePointStyle: true, boxWidth: 6 } } },
              scales: { ...commonOptions.scales, y: { type: 'linear', display: true, position: 'left', min: 0, max: 1.2, ticks: { stepSize: 1 } } }
            }} 
            data={{
              labels: chartData.labels,
              datasets: [
                {
                  label: 'Room 1 (Zone 1)',
                  data: chartData.motionPoints1,
                  borderColor: '#10b981',
                  backgroundColor: '#10b98122',
                  fill: true,
                  stepped: true,
                  borderWidth: 2
                },
                {
                  label: 'Room 2 (Zone 2)',
                  data: chartData.motionPoints2,
                  borderColor: '#f59e0b',
                  backgroundColor: '#f59e0b22',
                  fill: true,
                  stepped: true,
                  borderWidth: 2
                },
                {
                  label: 'Room 3 (Zone 3)',
                  data: chartData.motionPoints3,
                  borderColor: '#8b5cf6',
                  backgroundColor: '#8b5cf622',
                  fill: true,
                  stepped: true,
                  borderWidth: 2
                }
              ]
            }} 
          />
        </div>
      </div>
    </div>
  );
};

export default ChartOverlay;
