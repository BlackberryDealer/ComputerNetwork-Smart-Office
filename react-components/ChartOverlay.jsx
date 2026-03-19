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
    animation: false, // Disables the messy "spaghetti" jumping animation when entirely replacing chart datasets
    interaction: { mode: 'index', intersect: false },
    plugins: { legend: { display: false } }, // Remove default dots which clutter the lines
    elements: { point: { radius: 0, hitRadius: 10, hoverRadius: 4 } },
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

        {/* Chart 3: Motion detection (Live Topology + Historical Stacked Area) */}
        <div style={{ padding: '1.5rem', backgroundColor: '#f9fafb', borderRadius: '1rem' }}>
          <h4 style={{ margin: '0 0 1rem 0', color: '#1f2937', fontSize: '1rem' }}>Live Zone Occupancy (Topology)</h4>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
            {[
              { id: 1, name: 'Zone 1', active: chartData.motionPoints1[chartData.motionPoints1.length - 1] === 1, color: '#10b981' },
              { id: 2, name: 'Zone 2', active: chartData.motionPoints2[chartData.motionPoints2.length - 1] === 1, color: '#ef4444' },
              { id: 3, name: 'Zone 3', active: chartData.motionPoints3[chartData.motionPoints3.length - 1] === 1, color: '#facc15' }
            ].map(room => (
              <div key={room.name} style={{
                padding: '1.5rem 1rem',
                borderRadius: '0.8rem',
                backgroundColor: room.active ? room.color : '#e5e7eb',
                color: room.active ? '#fff' : '#6b7280',
                textAlign: 'center',
                transition: 'all 0.3s ease',
                boxShadow: room.active ? `0 0 20px ${room.color}66` : 'none',
                transform: room.active ? 'scale(1.02)' : 'scale(1)'
              }}>
                <div style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>{room.name}</div>
                <div style={{ fontSize: '0.85rem', textTransform: 'uppercase', marginTop: '0.5rem', fontWeight: 600, letterSpacing: '0.05em' }}>
                  {room.active ? 'Occupied' : 'Empty'}
                </div>
              </div>
            ))}
          </div>

          <h4 style={{ margin: '0 0 1rem 0', color: '#4b5563', fontSize: '0.9rem' }}>Historical Motion Activity (Stacked)</h4>
          <div style={{ height: '200px' }}>
            <Line 
              options={{
                ...commonOptions, 
                plugins: { legend: { display: true, position: 'top', labels: { usePointStyle: true, boxWidth: 6 } } },
                scales: { 
                  x: { ...commonOptions.scales.x },
                  y: { stacked: true, type: 'linear', display: true, position: 'left', min: 0, max: 3, ticks: { stepSize: 1 } } 
                }
              }} 
              data={{
                labels: chartData.labels,
                datasets: [
                  {
                    label: 'Zone 1',
                    data: chartData.motionPoints1,
                    borderColor: '#10b981',
                    backgroundColor: '#10b981aa',
                    fill: true,
                    stepped: true,
                    borderWidth: 1
                  },
                  {
                    label: 'Zone 2',
                    data: chartData.motionPoints2,
                    borderColor: '#ef4444',
                    backgroundColor: '#ef4444aa',
                    fill: true,
                    stepped: true,
                    borderWidth: 1
                  },
                  {
                    label: 'Zone 3',
                    data: chartData.motionPoints3,
                    borderColor: '#facc15',
                    backgroundColor: '#facc15aa',
                    fill: true,
                    stepped: true,
                    borderWidth: 1
                  }
                ]
              }} 
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChartOverlay;
